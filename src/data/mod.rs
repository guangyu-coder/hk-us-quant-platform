use crate::error::{AppError, AppResult, ValidationResult};
use crate::events::{EventBus, PlatformEvent};
use crate::types::MarketData;
use chrono::{DateTime, Utc};
use redis::aio::MultiplexedConnection as RedisConnection;
use rust_decimal::prelude::FromPrimitive;
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::process::Command;
use tracing::{debug, error, info, warn};

pub mod handlers;
pub mod lifecycle;
pub mod validators;

pub use lifecycle::*;
pub use validators::*;

/// Data service for market data collection, validation, and storage
pub struct DataService {
    db_pool: PgPool,
    redis_conn: RedisConnection,
    event_bus: Arc<EventBus>,
    validator: DataValidator,
}

impl DataService {
    /// Create a new data service instance
    pub async fn new(
        db_pool: PgPool,
        redis_conn: RedisConnection,
        event_bus: Arc<EventBus>,
    ) -> AppResult<Self> {
        let validator = DataValidator::new();

        Ok(Self {
            db_pool,
            redis_conn,
            event_bus,
            validator,
        })
    }

    /// Collect market data from external sources
    pub async fn collect_market_data(&self, symbols: Vec<String>) -> AppResult<()> {
        info!(
            "Starting market data collection for {} symbols",
            symbols.len()
        );

        for symbol in symbols {
            // This is a placeholder - in real implementation, this would connect to
            // actual market data providers like Bloomberg, Reuters, IEX, etc.
            match self.fetch_market_data_for_symbol(&symbol).await {
                Ok(market_data) => {
                    // Validate data quality
                    let validation_result = self.validate_data_quality(&market_data).await;

                    if validation_result.is_valid() {
                        // Store the data
                        if let Err(e) = self.store_market_data(&market_data).await {
                            error!("Failed to store market data for {}: {}", symbol, e);
                            continue;
                        }

                        // Publish event
                        let event = PlatformEvent::MarketDataReceived { data: market_data };
                        if let Err(e) = self.event_bus.publish(event).await {
                            warn!("Failed to publish market data event: {}", e);
                        }
                    } else {
                        // Handle invalid data
                        let reasons = validation_result.get_reasons();
                        warn!("Data quality check failed for {}: {:?}", symbol, reasons);

                        let event = PlatformEvent::DataQualityAlert {
                            symbol: symbol.clone(),
                            message: reasons.join(", "),
                        };

                        if let Err(e) = self.event_bus.publish(event).await {
                            warn!("Failed to publish data quality alert: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to fetch market data for {}: {}", symbol, e);

                    let event = PlatformEvent::DataSourceDisconnected {
                        source: format!("market_data_{}", symbol),
                        timestamp: Utc::now(),
                    };

                    if let Err(e) = self.event_bus.publish(event).await {
                        warn!("Failed to publish data source disconnection event: {}", e);
                    }
                }
            }
        }

        Ok(())
    }

    /// Get historical market data for a symbol within a time range
    pub async fn get_historical_data(
        &self,
        symbol: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> AppResult<Vec<MarketData>> {
        debug!(
            "Fetching historical data for {} from {} to {}",
            symbol, start, end
        );

        let query = r#"
            SELECT symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size
            FROM market_data 
            WHERE symbol = $1 AND timestamp >= $2 AND timestamp <= $3
            ORDER BY timestamp ASC
        "#;

        let rows = sqlx::query_as::<_, MarketDataRow>(query)
            .bind(symbol)
            .bind(start)
            .bind(end)
            .fetch_all(&self.db_pool)
            .await
            .map_err(|e| AppError::Database(e))?;

        let market_data: Vec<MarketData> = rows.into_iter().map(|row| row.into()).collect();

        debug!(
            "Retrieved {} historical data points for {}",
            market_data.len(),
            symbol
        );
        Ok(market_data)
    }

    /// Validate data quality
    pub async fn validate_data_quality(&self, data: &MarketData) -> ValidationResult {
        self.validator.validate(data)
    }

    /// Store market data to database
    async fn store_market_data(&self, data: &MarketData) -> AppResult<()> {
        let query = r#"
            INSERT INTO market_data (symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (symbol, timestamp) DO UPDATE SET
                price = EXCLUDED.price,
                volume = EXCLUDED.volume,
                bid_price = EXCLUDED.bid_price,
                ask_price = EXCLUDED.ask_price,
                bid_size = EXCLUDED.bid_size,
                ask_size = EXCLUDED.ask_size
        "#;

        sqlx::query(query)
            .bind(&data.symbol)
            .bind(data.timestamp)
            .bind(data.price)
            .bind(data.volume)
            .bind(data.bid_price)
            .bind(data.ask_price)
            .bind(data.bid_size)
            .bind(data.ask_size)
            .execute(&self.db_pool)
            .await
            .map_err(|e| AppError::Database(e))?;

        debug!(
            "Stored market data for {} at {}",
            data.symbol, data.timestamp
        );
        Ok(())
    }

    /// Fetch market data for a specific symbol (placeholder implementation)
    async fn fetch_market_data_for_symbol(&self, symbol: &str) -> AppResult<MarketData> {
        let script_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("market_data.py");

        let output = Command::new("python3")
            .arg(script_path)
            .arg("--symbol")
            .arg(symbol)
            .output()
            .await
            .map_err(|e| {
                AppError::market_data(format!(
                    "Failed to run market data script for {}: {}",
                    symbol, e
                ))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::market_data(format!(
                "Market data script failed for {}: {}",
                symbol, stderr
            )));
        }

        let response: Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| AppError::market_data(format!("Invalid market data response: {}", e)))?;

        if response.get("success") != Some(&serde_json::json!(true)) {
            return Err(AppError::market_data(format!(
                "Market data unavailable for {}",
                symbol
            )));
        }

        let price_data = &response["data"];
        let price = price_data["price"].as_f64().unwrap_or(0.0);
        let volume = price_data["volume"].as_i64().unwrap_or(0);
        let prev_close = price_data["previous_close"].as_f64().unwrap_or(price);

        use rust_decimal::Decimal;
        let mut data = MarketData::new(
            symbol.to_string(),
            Decimal::from_f64(price).unwrap_or_default(),
            volume,
        );

        data.previous_close = Some(Decimal::from_f64(prev_close).unwrap_or_default());
        data.open_price = price_data["open"].as_f64().and_then(Decimal::from_f64);
        data.high_price = price_data["high"].as_f64().and_then(Decimal::from_f64);
        data.low_price = price_data["low"].as_f64().and_then(Decimal::from_f64);
        data.data_source = response
            .get("source")
            .and_then(|v| v.as_str().map(|s| s.to_string()));

        Ok(data)
    }

    /// Get cached market data from Redis
    pub async fn get_cached_data(&self, symbol: &str) -> AppResult<Option<MarketData>> {
        use redis::AsyncCommands;

        let mut conn = self.redis_conn.clone();
        let key = format!("market_data:{}", symbol);

        let cached_data: Option<String> = conn.get(&key).await.map_err(|e| AppError::Redis(e))?;

        match cached_data {
            Some(data) => {
                let market_data: MarketData =
                    serde_json::from_str(&data).map_err(|e| AppError::Serialization(e))?;
                Ok(Some(market_data))
            }
            None => Ok(None),
        }
    }

    /// Cache market data in Redis
    pub async fn cache_data(&self, data: &MarketData) -> AppResult<()> {
        use redis::AsyncCommands;

        let mut conn = self.redis_conn.clone();
        let key = format!("market_data:{}", data.symbol);
        let serialized = serde_json::to_string(data).map_err(|e| AppError::Serialization(e))?;

        // Cache for 5 minutes
        conn.set_ex::<_, _, ()>(&key, serialized, 300)
            .await
            .map_err(|e| AppError::Redis(e))?;

        Ok(())
    }
}

/// Database row structure for market data
#[derive(sqlx::FromRow)]
struct MarketDataRow {
    symbol: String,
    timestamp: DateTime<Utc>,
    price: rust_decimal::Decimal,
    volume: i64,
    bid_price: Option<rust_decimal::Decimal>,
    ask_price: Option<rust_decimal::Decimal>,
    bid_size: Option<i64>,
    ask_size: Option<i64>,
}

impl From<MarketDataRow> for MarketData {
    fn from(row: MarketDataRow) -> Self {
        MarketData {
            symbol: row.symbol,
            timestamp: row.timestamp,
            price: row.price,
            volume: row.volume,
            bid_price: row.bid_price,
            ask_price: row.ask_price,
            bid_size: row.bid_size,
            ask_size: row.ask_size,
            open_price: None,
            high_price: None,
            low_price: None,
            previous_close: None,
            market_cap: None,
            pe_ratio: None,
            data_source: None,
            exchange: None,
        }
    }
}
