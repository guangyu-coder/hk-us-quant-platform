use crate::error::{AppError, AppResult};
use crate::events::{EventBus, PlatformEvent};
use crate::types::{
    BacktestEquityPoint, BacktestResult, BacktestTrade, MarketData, Signal, StrategyConfig,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use rust_decimal::MathematicalOps;
use sqlx::{PgPool, Postgres, QueryBuilder};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};
use uuid::Uuid;

pub mod indicators;
pub mod strategies;

pub use strategies::{
    BollingerBandsStrategy, DualMACrossoverStrategy, MACDStrategy, PairsTradingStrategy,
    RSIStrategy,
};

use self::indicators::{sma, BollingerBands, MACD, RSI};

/// Strategy trait for implementing trading strategies
#[async_trait]
pub trait Strategy: Send + Sync {
    async fn generate_signals(&self, market_data: &MarketData) -> AppResult<Vec<Signal>>;
    async fn update_parameters(
        &mut self,
        params: HashMap<String, serde_json::Value>,
    ) -> AppResult<()>;
    fn get_name(&self) -> &str;
    fn get_description(&self) -> &str;
}

/// Strategy service for managing trading strategies
pub struct StrategyService {
    db_pool: PgPool,
    event_bus: Arc<EventBus>,
    strategies: RwLock<HashMap<String, Arc<dyn Strategy>>>,
}

impl StrategyService {
    /// Create a new strategy service
    pub async fn new(db_pool: PgPool, event_bus: Arc<EventBus>) -> AppResult<Self> {
        Ok(Self {
            db_pool,
            event_bus,
            strategies: RwLock::new(HashMap::new()),
        })
    }

    /// Load a strategy configuration
    pub async fn load_strategy(&self, config: StrategyConfig) -> AppResult<()> {
        let config = validate_and_normalize_strategy_config(config)?;
        info!(
            "Loading strategy: {} [{}] ({})",
            config.display_name.as_deref().unwrap_or(&config.name),
            config.name,
            config.id
        );

        // Store strategy configuration in database
        let query = r#"
            INSERT INTO strategies (strategy_id, name, display_name, description, config, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (strategy_id) DO UPDATE SET
                name = EXCLUDED.name,
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                config = EXCLUDED.config,
                is_active = EXCLUDED.is_active,
                updated_at = EXCLUDED.updated_at
        "#;

        let config_json =
            serde_json::to_value(&config.parameters).map_err(|e| AppError::Serialization(e))?;

        sqlx::query(query)
            .bind(&config.id)
            .bind(&config.name)
            .bind(&config.display_name)
            .bind(&config.description)
            .bind(config_json)
            .bind(config.is_active)
            .bind(config.created_at)
            .bind(config.updated_at)
            .execute(&self.db_pool)
            .await
            .map_err(|e| AppError::Database(e))?;

        // Create strategy instance based on configuration
        match self.create_strategy_instance(&config) {
            Ok(strategy) => {
                let strategy = Arc::<dyn Strategy>::from(strategy);
                let mut strategies = self.strategies.write().await;
                strategies.insert(config.id.clone(), strategy);
            }
            Err(AppError::Strategy { .. }) => {
                warn!(
                    "Strategy {} [{}] ({}) stored but not loaded in memory",
                    config.display_name.as_deref().unwrap_or(&config.name),
                    config.name,
                    config.id
                );
            }
            Err(e) => return Err(e),
        }

        debug!("Strategy {} loaded successfully", config.id);
        Ok(())
    }

    /// Generate signals from all active strategies
    pub async fn generate_signals(&self, market_data: &MarketData) -> AppResult<Vec<Signal>> {
        let mut all_signals = Vec::new();

        let strategies = {
            let strategies = self.strategies.read().await;
            strategies
                .iter()
                .map(|(id, strategy)| (id.clone(), strategy.clone()))
                .collect::<Vec<_>>()
        };

        for (strategy_id, strategy) in strategies {
            match strategy.generate_signals(market_data).await {
                Ok(mut signals) => {
                    debug!(
                        "Strategy {} generated {} signals",
                        strategy_id,
                        signals.len()
                    );
                    all_signals.append(&mut signals);
                }
                Err(e) => {
                    warn!("Strategy {} failed to generate signals: {}", strategy_id, e);

                    // Publish strategy error event
                    let event = PlatformEvent::StrategyError {
                        strategy_id: strategy_id.clone(),
                        error: e.to_string(),
                    };

                    if let Err(e) = self.event_bus.publish(event).await {
                        warn!("Failed to publish strategy error event: {}", e);
                    }
                }
            }
        }

        // Publish signal generated events
        for signal in &all_signals {
            let event = PlatformEvent::SignalGenerated {
                signal: signal.clone(),
            };

            if let Err(e) = self.event_bus.publish(event).await {
                warn!("Failed to publish signal generated event: {}", e);
            }
        }

        Ok(all_signals)
    }

    /// Run backtest for a specific strategy
    pub async fn run_backtest(
        &self,
        strategy_id: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> AppResult<BacktestResult> {
        info!(
            "Running backtest for strategy {} from {} to {}",
            strategy_id, start, end
        );
        let config = self.get_strategy_config(strategy_id).await?;
        let symbol = config
            .parameters
            .get("symbol")
            .and_then(|value| value.as_str())
            .unwrap_or("AAPL")
            .to_string();
        let timeframe = config
            .parameters
            .get("timeframe")
            .and_then(|value| value.as_str())
            .unwrap_or("1d")
            .to_string();
        let initial_capital = config
            .parameters
            .get("initial_capital")
            .and_then(|value| value.as_f64())
            .and_then(Decimal::from_f64)
            .unwrap_or_else(|| Decimal::new(100000, 0));

        let historical_data = self
            .load_backtest_market_data(&symbol, start, end, &timeframe)
            .await?;

        if historical_data.len() < 20 {
            return Err(AppError::strategy(format!(
                "Not enough historical data to run backtest for {}",
                strategy_id
            )));
        }

        let result = simulate_backtest(strategy_id, &config, historical_data, initial_capital)?;
        let mut result = attach_strategy_context_to_backtest_result(result, &config);

        let run_id = self.store_backtest_run(&config, &result).await?;
        result.run_id = Some(run_id);

        // Publish backtest completed event
        let event = PlatformEvent::BacktestCompleted {
            strategy_id: strategy_id.to_string(),
            result: serde_json::to_value(&result).map_err(|e| AppError::Serialization(e))?,
        };

        if let Err(e) = self.event_bus.publish(event).await {
            warn!("Failed to publish backtest completed event: {}", e);
        }

        Ok(result)
    }

    pub async fn list_backtest_runs(&self, limit: i64) -> AppResult<Vec<BacktestResult>> {
        self.list_backtest_runs_filtered(limit, None, None).await
    }

    pub async fn list_backtest_runs_filtered(
        &self,
        limit: i64,
        strategy_id: Option<&str>,
        symbol: Option<&str>,
    ) -> AppResult<Vec<BacktestResult>> {
        #[derive(sqlx::FromRow)]
        struct BacktestRunRow {
            id: Uuid,
            strategy_id: String,
            strategy_name: String,
            symbol: String,
            timeframe: String,
            parameters: serde_json::Value,
            trades: serde_json::Value,
            equity_curve: serde_json::Value,
            start_date: chrono::DateTime<chrono::Utc>,
            end_date: chrono::DateTime<chrono::Utc>,
            initial_capital: Decimal,
            final_capital: Decimal,
            total_return: f64,
            annualized_return: f64,
            sharpe_ratio: f64,
            max_drawdown: f64,
            win_rate: f64,
            total_trades: i32,
            performance_metrics: serde_json::Value,
            created_at: chrono::DateTime<chrono::Utc>,
        }

        let mut query_builder = QueryBuilder::<Postgres>::new(
            "SELECT id, strategy_id, strategy_name, symbol, timeframe, parameters, trades, equity_curve, start_date, end_date, \
             initial_capital, final_capital, total_return, annualized_return, sharpe_ratio, max_drawdown, \
             win_rate, total_trades, performance_metrics, created_at FROM backtest_runs",
        );

        let mut has_filter = false;
        if let Some(strategy_id) = strategy_id.filter(|value| !value.trim().is_empty()) {
            query_builder.push(if has_filter { " AND " } else { " WHERE " });
            query_builder.push("strategy_id = ");
            query_builder.push_bind(strategy_id.trim());
            has_filter = true;
        }
        if let Some(symbol) = symbol.filter(|value| !value.trim().is_empty()) {
            query_builder.push(if has_filter { " AND " } else { " WHERE " });
            query_builder.push("symbol = ");
            query_builder.push_bind(symbol.trim());
        }

        query_builder.push(" ORDER BY created_at DESC LIMIT ");
        query_builder.push_bind(limit);

        let rows = query_builder
            .build_query_as::<BacktestRunRow>()
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        rows.into_iter()
            .map(|row| {
                let metrics: crate::types::PerformanceMetrics =
                    serde_json::from_value(row.performance_metrics)
                        .map_err(AppError::Serialization)?;
                let parameters: HashMap<String, serde_json::Value> =
                    serde_json::from_value(row.parameters).map_err(AppError::Serialization)?;
                let trades: Vec<BacktestTrade> =
                    serde_json::from_value(row.trades).map_err(AppError::Serialization)?;
                let equity_curve: Vec<BacktestEquityPoint> =
                    serde_json::from_value(row.equity_curve).map_err(AppError::Serialization)?;
                Ok(BacktestResult {
                    run_id: Some(row.id),
                    strategy_id: row.strategy_id,
                    strategy_name: Some(row.strategy_name),
                    symbol: Some(row.symbol),
                    timeframe: Some(row.timeframe),
                    parameters: Some(parameters),
                    trades: Some(trades),
                    equity_curve: Some(equity_curve),
                    start_date: row.start_date,
                    end_date: row.end_date,
                    initial_capital: row.initial_capital,
                    final_capital: row.final_capital,
                    total_return: row.total_return,
                    annualized_return: row.annualized_return,
                    sharpe_ratio: row.sharpe_ratio,
                    max_drawdown: row.max_drawdown,
                    win_rate: row.win_rate,
                    total_trades: row.total_trades,
                    performance_metrics: metrics,
                    created_at: Some(row.created_at),
                })
            })
            .collect()
    }

    async fn load_backtest_market_data(
        &self,
        symbol: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        timeframe: &str,
    ) -> AppResult<Vec<MarketData>> {
        let query = r#"
            SELECT symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size
            FROM market_data
            WHERE symbol = $1 AND timestamp >= $2 AND timestamp <= $3
            ORDER BY timestamp ASC
        "#;

        #[derive(sqlx::FromRow)]
        struct BacktestMarketDataRow {
            symbol: String,
            timestamp: chrono::DateTime<chrono::Utc>,
            price: rust_decimal::Decimal,
            volume: i64,
            bid_price: Option<rust_decimal::Decimal>,
            ask_price: Option<rust_decimal::Decimal>,
            bid_size: Option<i64>,
            ask_size: Option<i64>,
        }

        let rows = sqlx::query_as::<_, BacktestMarketDataRow>(query)
            .bind(symbol)
            .bind(start)
            .bind(end)
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        if rows.len() >= 20 {
            return Ok(rows
                .into_iter()
                .map(|row| MarketData {
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
                    data_source: Some("database".to_string()),
                    exchange: None,
                })
                .collect());
        }

        let yahoo_client = crate::market_data::yahoo_finance::YahooFinanceClient::new();
        yahoo_client
            .get_historical_bars(symbol, start, end, timeframe)
            .await
    }

    async fn store_backtest_run(
        &self,
        config: &StrategyConfig,
        result: &BacktestResult,
    ) -> AppResult<Uuid> {
        let run_id = Uuid::new_v4();
        let query = r#"
            INSERT INTO backtest_runs (
                id, strategy_id, strategy_name, symbol, timeframe, parameters,
                trades, equity_curve,
                start_date, end_date, initial_capital, final_capital, total_return,
                annualized_return, sharpe_ratio, max_drawdown, win_rate, total_trades,
                performance_metrics, created_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11,
                $12, $13, $14, $15, $16,
                $17, $18, $19, $20
            )
        "#;

        sqlx::query(query)
            .bind(run_id)
            .bind(&result.strategy_id)
            .bind(
                result
                    .strategy_name
                    .as_deref()
                    .or(config.display_name.as_deref())
                    .unwrap_or(&config.name),
            )
            .bind(result.symbol.as_deref().unwrap_or("AAPL"))
            .bind(result.timeframe.as_deref().unwrap_or("1d"))
            .bind(serde_json::to_value(&config.parameters).map_err(AppError::Serialization)?)
            .bind(serde_json::to_value(&result.trades).map_err(AppError::Serialization)?)
            .bind(serde_json::to_value(&result.equity_curve).map_err(AppError::Serialization)?)
            .bind(result.start_date)
            .bind(result.end_date)
            .bind(result.initial_capital)
            .bind(result.final_capital)
            .bind(result.total_return)
            .bind(result.annualized_return)
            .bind(result.sharpe_ratio)
            .bind(result.max_drawdown)
            .bind(result.win_rate)
            .bind(result.total_trades)
            .bind(
                serde_json::to_value(&result.performance_metrics)
                    .map_err(AppError::Serialization)?,
            )
            .bind(result.created_at.unwrap_or_else(Utc::now))
            .execute(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(run_id)
    }

    /// Create strategy instance based on configuration
    fn create_strategy_instance(&self, config: &StrategyConfig) -> AppResult<Box<dyn Strategy>> {
        // This is a placeholder - in a real system, this would use a factory pattern
        // to create different strategy types based on the configuration

        match normalize_strategy_kind(&config.name).as_str() {
            "simple_moving_average" => {
                Ok(Box::new(SimpleMovingAverageStrategy::new(config.clone())?))
            }
            "mean_reversion" => Ok(Box::new(MeanReversionStrategy::new(config.clone())?)),
            "rsi" | "rsi_strategy" => Ok(Box::new(RSIStrategy::new(config.clone())?)),
            "macd" | "macd_strategy" => Ok(Box::new(MACDStrategy::new(config.clone())?)),
            "bollinger" | "bollinger_bands" => {
                Ok(Box::new(BollingerBandsStrategy::new(config.clone())?))
            }
            "dual_ma" | "ma_crossover" => {
                Ok(Box::new(DualMACrossoverStrategy::new(config.clone())?))
            }
            "pairs_trading" | "statistical_arbitrage" => {
                Ok(Box::new(PairsTradingStrategy::new(config.clone())?))
            }
            _ => Err(AppError::strategy(format!(
                "Unknown strategy type: {}",
                config.name
            ))),
        }
    }

    /// Get all loaded strategies
    pub async fn get_strategies(&self) -> Vec<String> {
        let strategies = self.strategies.read().await;
        strategies.keys().cloned().collect()
    }

    /// Get strategy by ID
    pub async fn get_strategy(&self, strategy_id: &str) -> Option<Arc<dyn Strategy>> {
        let strategies = self.strategies.read().await;
        strategies.get(strategy_id).cloned()
    }

    pub async fn list_strategies(&self) -> AppResult<Vec<StrategyConfig>> {
        let query = r#"
            SELECT strategy_id, name, display_name, description, config, is_active, created_at, updated_at
            FROM strategies
            ORDER BY updated_at DESC
        "#;

        let rows = sqlx::query_as::<_, StrategyRow>(query)
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(rows.into_iter().map(StrategyConfig::from).collect())
    }

    pub async fn get_strategy_config(&self, strategy_id: &str) -> AppResult<StrategyConfig> {
        let query = r#"
            SELECT strategy_id, name, display_name, description, config, is_active, created_at, updated_at
            FROM strategies
            WHERE strategy_id = $1
        "#;

        let row = sqlx::query_as::<_, StrategyRow>(query)
            .bind(strategy_id)
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => {
                    AppError::not_found(format!("Strategy {}", strategy_id))
                }
                _ => AppError::Database(e),
            })?;

        Ok(row.into())
    }

    pub async fn deactivate_strategy(&self, strategy_id: &str) -> AppResult<()> {
        let query = r#"
            UPDATE strategies
            SET is_active = FALSE, updated_at = NOW()
            WHERE strategy_id = $1
        "#;

        let rows_affected = sqlx::query(query)
            .bind(strategy_id)
            .execute(&self.db_pool)
            .await
            .map_err(AppError::Database)?
            .rows_affected();

        if rows_affected == 0 {
            return Err(AppError::not_found(format!("Strategy {}", strategy_id)));
        }

        let mut strategies = self.strategies.write().await;
        strategies.remove(strategy_id);

        Ok(())
    }

    pub async fn delete_strategy(&self, strategy_id: &str) -> AppResult<()> {
        let mut tx = self.db_pool.begin().await.map_err(AppError::Database)?;

        for table in strategy_related_cleanup_tables() {
            let query = format!("DELETE FROM {table} WHERE strategy_id = $1");
            sqlx::query(&query)
                .bind(strategy_id)
                .execute(&mut *tx)
                .await
                .map_err(AppError::Database)?;
        }

        let rows_affected = sqlx::query("DELETE FROM strategies WHERE strategy_id = $1")
            .bind(strategy_id)
            .execute(&mut *tx)
            .await
            .map_err(AppError::Database)?
            .rows_affected();

        if rows_affected == 0 {
            return Err(AppError::not_found(format!("Strategy {}", strategy_id)));
        }

        tx.commit().await.map_err(AppError::Database)?;

        let mut strategies = self.strategies.write().await;
        strategies.remove(strategy_id);

        Ok(())
    }
}

fn strategy_related_cleanup_tables() -> &'static [&'static str] {
    &[
        "trades_archive",
        "orders_archive",
        "backtest_runs",
        "performance_metrics",
        "trades",
        "orders",
    ]
}

#[derive(sqlx::FromRow)]
struct StrategyRow {
    strategy_id: String,
    name: String,
    display_name: Option<String>,
    description: Option<String>,
    config: serde_json::Value,
    is_active: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<StrategyRow> for StrategyConfig {
    fn from(row: StrategyRow) -> Self {
        let strategy_kind = normalize_strategy_kind(&row.name);
        let display_name = normalize_display_name(row.display_name.as_deref(), &strategy_kind)
            .unwrap_or_else(|_| Some(default_strategy_display_name(&strategy_kind)));
        let parameters = row
            .config
            .as_object()
            .map(|obj| obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();

        StrategyConfig {
            id: row.strategy_id,
            name: row.name,
            display_name,
            description: row.description,
            parameters,
            risk_limits: crate::types::RiskLimits::default(),
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// Simple Moving Average Strategy implementation
pub struct SimpleMovingAverageStrategy {
    config: StrategyConfig,
    price_history: Vec<rust_decimal::Decimal>,
    window_size: usize,
}

impl SimpleMovingAverageStrategy {
    pub fn new(config: StrategyConfig) -> AppResult<Self> {
        let window_size = config
            .parameters
            .get("window_size")
            .and_then(|v| v.as_u64())
            .unwrap_or(20) as usize;

        Ok(Self {
            config,
            price_history: Vec::new(),
            window_size,
        })
    }
}

#[async_trait]
impl Strategy for SimpleMovingAverageStrategy {
    async fn generate_signals(&self, market_data: &MarketData) -> AppResult<Vec<Signal>> {
        // Simple moving average strategy logic
        // This is a basic implementation for demonstration

        let mut signals = Vec::new();

        // Add current price to history (in real implementation, this would be managed differently)
        let current_price = market_data.price;

        // Generate signal based on simple logic
        if self.price_history.len() >= self.window_size {
            let avg: rust_decimal::Decimal = self
                .price_history
                .iter()
                .rev()
                .take(self.window_size)
                .sum::<rust_decimal::Decimal>()
                / rust_decimal::Decimal::from(self.window_size);

            let signal_type = if current_price > avg {
                crate::types::SignalType::Buy
            } else if current_price < avg {
                crate::types::SignalType::Sell
            } else {
                crate::types::SignalType::Hold
            };

            let strength = ((current_price - avg).abs() / avg)
                .to_f64()
                .unwrap_or(0.0)
                .min(1.0);

            let signal = Signal::new(
                self.config.id.clone(),
                market_data.symbol.clone(),
                signal_type,
                strength,
            );

            signals.push(signal);
        }

        Ok(signals)
    }

    async fn update_parameters(
        &mut self,
        params: HashMap<String, serde_json::Value>,
    ) -> AppResult<()> {
        if let Some(window_size) = params.get("window_size").and_then(|v| v.as_u64()) {
            self.window_size = window_size as usize;
        }

        // Update config parameters
        for (key, value) in params {
            self.config.parameters.insert(key, value);
        }

        Ok(())
    }

    fn get_name(&self) -> &str {
        &self.config.name
    }

    fn get_description(&self) -> &str {
        self.config
            .description
            .as_deref()
            .unwrap_or("Simple Moving Average Strategy")
    }
}

/// Mean Reversion Strategy implementation
pub struct MeanReversionStrategy {
    config: StrategyConfig,
}

impl MeanReversionStrategy {
    pub fn new(config: StrategyConfig) -> AppResult<Self> {
        Ok(Self { config })
    }
}

fn normalize_strategy_kind(name: &str) -> String {
    name.trim()
        .to_ascii_lowercase()
        .replace('-', "_")
        .replace(' ', "_")
}

fn ensure_positive_usize(
    parameters: &mut HashMap<String, serde_json::Value>,
    key: &str,
    default: u64,
) -> AppResult<usize> {
    let value = parameters
        .get(key)
        .and_then(|value| value.as_u64())
        .unwrap_or(default);
    if value == 0 {
        return Err(AppError::strategy(format!("{key} must be greater than 0")));
    }
    parameters.insert(key.to_string(), serde_json::json!(value));
    Ok(value as usize)
}

fn ensure_positive_f64(
    parameters: &mut HashMap<String, serde_json::Value>,
    key: &str,
    default: f64,
) -> AppResult<f64> {
    let value = parameters
        .get(key)
        .and_then(|value| value.as_f64())
        .unwrap_or(default);
    if !value.is_finite() || value <= 0.0 {
        return Err(AppError::strategy(format!("{key} must be greater than 0")));
    }
    parameters.insert(key.to_string(), serde_json::json!(value));
    Ok(value)
}

fn ensure_bounded_f64(
    parameters: &mut HashMap<String, serde_json::Value>,
    key: &str,
    default: f64,
    min: f64,
    max: f64,
) -> AppResult<f64> {
    let value = parameters
        .get(key)
        .and_then(|value| value.as_f64())
        .unwrap_or(default);
    if !value.is_finite() || value < min || value > max {
        return Err(AppError::strategy(format!(
            "{key} must be between {min} and {max}"
        )));
    }
    parameters.insert(key.to_string(), serde_json::json!(value));
    Ok(value)
}

fn ensure_non_empty_string(
    parameters: &mut HashMap<String, serde_json::Value>,
    key: &str,
    default: Option<&str>,
) -> AppResult<String> {
    let raw = parameters
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| default.map(str::to_string))
        .ok_or_else(|| AppError::strategy(format!("Missing parameter: {key}")))?;
    parameters.insert(key.to_string(), serde_json::json!(raw));
    Ok(raw)
}

fn validate_and_normalize_strategy_config(mut config: StrategyConfig) -> AppResult<StrategyConfig> {
    let kind = normalize_strategy_kind(&config.name);
    config.name = kind.clone();
    config.display_name = normalize_display_name(config.display_name.as_deref(), &kind)?;

    let symbol = ensure_non_empty_string(&mut config.parameters, "symbol", Some("AAPL"))?;
    let timeframe = ensure_non_empty_string(&mut config.parameters, "timeframe", Some("1d"))?;
    let initial_capital = ensure_positive_f64(&mut config.parameters, "initial_capital", 100000.0)?;

    let allowed_timeframes = ["1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"];
    if !allowed_timeframes.contains(&timeframe.as_str()) {
        return Err(AppError::strategy(format!(
            "timeframe must be one of: {}",
            allowed_timeframes.join(", ")
        )));
    }

    if symbol.len() > 32 {
        return Err(AppError::strategy("symbol is too long"));
    }

    if initial_capital < 100.0 {
        return Err(AppError::strategy("initial_capital must be at least 100"));
    }

    ensure_bounded_f64(&mut config.parameters, "fee_bps", 5.0, 0.0, 1000.0)?;
    ensure_bounded_f64(&mut config.parameters, "slippage_bps", 2.0, 0.0, 1000.0)?;
    ensure_bounded_f64(
        &mut config.parameters,
        "max_position_fraction",
        1.0,
        0.01,
        1.0,
    )?;

    match kind.as_str() {
        "simple_moving_average" | "dual_ma" | "ma_crossover" => {
            let short_period = ensure_positive_usize(&mut config.parameters, "short_period", 5)?;
            let long_period = ensure_positive_usize(&mut config.parameters, "long_period", 20)?;
            if short_period >= long_period {
                return Err(AppError::strategy(
                    "short_period must be smaller than long_period",
                ));
            }
        }
        "rsi" | "rsi_strategy" => {
            let period = ensure_positive_usize(&mut config.parameters, "period", 14)?;
            if period < 2 {
                return Err(AppError::strategy("period must be at least 2"));
            }
            let oversold =
                ensure_bounded_f64(&mut config.parameters, "oversold", 30.0, 0.0, 100.0)?;
            let overbought =
                ensure_bounded_f64(&mut config.parameters, "overbought", 70.0, 0.0, 100.0)?;
            if oversold >= overbought {
                return Err(AppError::strategy(
                    "oversold must be smaller than overbought",
                ));
            }
        }
        "macd" | "macd_strategy" => {
            let fast_period = ensure_positive_usize(&mut config.parameters, "fast_period", 12)?;
            let slow_period = ensure_positive_usize(&mut config.parameters, "slow_period", 26)?;
            let signal_period = ensure_positive_usize(&mut config.parameters, "signal_period", 9)?;
            if fast_period >= slow_period {
                return Err(AppError::strategy(
                    "fast_period must be smaller than slow_period",
                ));
            }
            if signal_period >= slow_period {
                return Err(AppError::strategy(
                    "signal_period should be smaller than slow_period",
                ));
            }
        }
        "bollinger" | "bollinger_bands" => {
            let period = ensure_positive_usize(&mut config.parameters, "period", 20)?;
            if period < 2 {
                return Err(AppError::strategy("period must be at least 2"));
            }
            ensure_positive_f64(&mut config.parameters, "std_dev", 2.0)?;
        }
        "mean_reversion" => {
            let lookback = ensure_positive_usize(&mut config.parameters, "lookback_period", 20)?;
            if lookback < 2 {
                return Err(AppError::strategy("lookback_period must be at least 2"));
            }
            ensure_positive_f64(&mut config.parameters, "threshold", 2.0)?;
        }
        "pairs_trading" | "statistical_arbitrage" => {
            let asset_a = ensure_non_empty_string(&mut config.parameters, "asset_a", None)?;
            let asset_b = ensure_non_empty_string(&mut config.parameters, "asset_b", None)?;
            if asset_a == asset_b {
                return Err(AppError::strategy("asset_a and asset_b must be different"));
            }
            let lookback = ensure_positive_usize(&mut config.parameters, "lookback_period", 20)?;
            if lookback < 2 {
                return Err(AppError::strategy("lookback_period must be at least 2"));
            }
            ensure_positive_f64(&mut config.parameters, "threshold", 2.0)?;
        }
        _ => {
            return Err(AppError::strategy(format!(
                "Unknown strategy type: {}",
                config.name
            )));
        }
    }

    Ok(config)
}

fn attach_strategy_context_to_backtest_result(
    mut result: BacktestResult,
    config: &StrategyConfig,
) -> BacktestResult {
    result.strategy_name = Some(
        config
            .display_name
            .clone()
            .unwrap_or_else(|| config.name.clone()),
    );
    result.symbol = config
        .parameters
        .get("symbol")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| Some("AAPL".to_string()));
    result.timeframe = config
        .parameters
        .get("timeframe")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| Some("1d".to_string()));
    result.parameters = Some(config.parameters.clone());
    result.created_at = Some(Utc::now());
    result
}

fn normalize_display_name(
    display_name: Option<&str>,
    strategy_kind: &str,
) -> AppResult<Option<String>> {
    let provided = display_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let normalized = match provided {
        Some(value) if normalize_strategy_kind(&value) == strategy_kind => {
            default_strategy_display_name(strategy_kind)
        }
        Some(value) => value,
        None => default_strategy_display_name(strategy_kind),
    };

    if normalized.chars().count() > 100 {
        return Err(AppError::strategy("display_name is too long"));
    }

    Ok(Some(normalized))
}

fn default_strategy_display_name(strategy_kind: &str) -> String {
    match strategy_kind {
        "simple_moving_average" => "SMA 双均线".to_string(),
        "rsi" => "RSI 反转".to_string(),
        "macd" => "MACD 趋势".to_string(),
        "bollinger" | "bollinger_bands" => "布林带均值回归".to_string(),
        "mean_reversion" => "均值回归".to_string(),
        other => title_case_strategy_name(other),
    }
}

fn title_case_strategy_name(value: &str) -> String {
    value
        .split('_')
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, Clone)]
struct ClosedTrade {
    pnl: Decimal,
}

fn simulate_backtest(
    strategy_id: &str,
    config: &StrategyConfig,
    historical_data: Vec<MarketData>,
    initial_capital: Decimal,
) -> AppResult<BacktestResult> {
    let kind = normalize_strategy_kind(&config.name);
    let closes: Vec<Decimal> = historical_data.iter().map(|bar| bar.price).collect();
    let fee_rate = Decimal::from_f64(
        config
            .parameters
            .get("fee_bps")
            .and_then(|value| value.as_f64())
            .unwrap_or(5.0)
            / 10_000.0,
    )
    .unwrap_or(Decimal::ZERO);
    let slippage_rate = Decimal::from_f64(
        config
            .parameters
            .get("slippage_bps")
            .and_then(|value| value.as_f64())
            .unwrap_or(2.0)
            / 10_000.0,
    )
    .unwrap_or(Decimal::ZERO);
    let max_position_fraction = Decimal::from_f64(
        config
            .parameters
            .get("max_position_fraction")
            .and_then(|value| value.as_f64())
            .unwrap_or(1.0),
    )
    .unwrap_or(Decimal::ONE);
    let mut cash = initial_capital;
    let mut quantity: i64 = 0;
    let mut entry_value = Decimal::ZERO;
    let mut equity_curve = Vec::with_capacity(historical_data.len());
    let mut trade_log = Vec::new();
    let mut trades = Vec::new();

    for index in 1..historical_data.len() {
        let slice = &closes[..=index];
        let should_buy = backtest_buy_signal(&kind, config, slice);
        let should_sell = backtest_sell_signal(&kind, config, slice);
        let price = closes[index];
        let timestamp = historical_data[index].timestamp;

        if quantity == 0 && should_buy {
            let execution_price = price * (Decimal::ONE + slippage_rate);
            let budget = cash * max_position_fraction;
            let per_share_cost = execution_price * (Decimal::ONE + fee_rate);
            let qty = (budget / per_share_cost).floor().to_i64().unwrap_or(0);
            if qty > 0 {
                let notional = execution_price * Decimal::from(qty);
                let fees = notional * fee_rate;
                quantity = qty;
                entry_value = notional + fees;
                cash -= entry_value;
                trade_log.push(BacktestTrade {
                    timestamp,
                    side: "buy".to_string(),
                    quantity: qty,
                    signal_price: price,
                    execution_price,
                    fees,
                    pnl: None,
                });
            }
        } else if quantity > 0 && should_sell {
            let execution_price = price * (Decimal::ONE - slippage_rate);
            let gross_proceeds = execution_price * Decimal::from(quantity);
            let fees = gross_proceeds * fee_rate;
            let net_proceeds = gross_proceeds - fees;
            let pnl = net_proceeds - entry_value;
            cash += net_proceeds;
            trades.push(ClosedTrade { pnl });
            trade_log.push(BacktestTrade {
                timestamp,
                side: "sell".to_string(),
                quantity,
                signal_price: price,
                execution_price,
                fees,
                pnl: Some(pnl),
            });
            quantity = 0;
            entry_value = Decimal::ZERO;
        }

        let marked_value = if quantity > 0 {
            let gross_value = price * Decimal::from(quantity);
            gross_value * (Decimal::ONE - fee_rate - slippage_rate)
        } else {
            Decimal::ZERO
        };
        let equity = cash + marked_value;
        equity_curve.push(BacktestEquityPoint {
            timestamp,
            equity,
            cash,
            position_quantity: quantity,
            market_price: price,
        });
    }

    if quantity > 0 {
        let last_price = *closes.last().unwrap_or(&Decimal::ZERO);
        let timestamp = historical_data.last().unwrap().timestamp;
        let execution_price = last_price * (Decimal::ONE - slippage_rate);
        let gross_proceeds = execution_price * Decimal::from(quantity);
        let fees = gross_proceeds * fee_rate;
        let net_proceeds = gross_proceeds - fees;
        let pnl = net_proceeds - entry_value;
        cash += net_proceeds;
        trades.push(ClosedTrade { pnl });
        trade_log.push(BacktestTrade {
            timestamp,
            side: "sell".to_string(),
            quantity,
            signal_price: last_price,
            execution_price,
            fees,
            pnl: Some(pnl),
        });
    }

    let final_capital = cash;
    let total_return = if initial_capital > Decimal::ZERO {
        ((final_capital - initial_capital) / initial_capital)
            .to_f64()
            .unwrap_or(0.0)
    } else {
        0.0
    };

    let period_days = (historical_data.last().unwrap().timestamp
        - historical_data.first().unwrap().timestamp)
        .num_days()
        .max(1) as f64;
    let annualized_return = (1.0 + total_return).powf(365.0 / period_days).max(0.0) - 1.0;

    let returns = equity_curve
        .windows(2)
        .filter_map(|pair| {
            let prev = pair[0].equity;
            let next = pair[1].equity;
            if prev > Decimal::ZERO {
                ((next - prev) / prev).to_f64()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    let sharpe_ratio = calculate_sharpe_ratio(&returns);
    let max_drawdown = calculate_max_drawdown(&equity_curve);
    let performance_metrics = build_performance_metrics(
        &trades,
        final_capital - initial_capital,
        &returns,
        annualized_return,
        max_drawdown,
    );
    let win_count = trades
        .iter()
        .filter(|trade| trade.pnl > Decimal::ZERO)
        .count();
    let win_rate = if trades.is_empty() {
        0.0
    } else {
        win_count as f64 / trades.len() as f64
    };

    Ok(BacktestResult {
        run_id: None,
        strategy_id: strategy_id.to_string(),
        strategy_name: None,
        symbol: None,
        timeframe: None,
        parameters: None,
        trades: Some(trade_log),
        equity_curve: Some(equity_curve),
        start_date: historical_data.first().unwrap().timestamp,
        end_date: historical_data.last().unwrap().timestamp,
        initial_capital,
        final_capital,
        total_return,
        annualized_return,
        sharpe_ratio,
        max_drawdown,
        win_rate,
        total_trades: trades.len() as i32,
        performance_metrics,
        created_at: None,
    })
}

fn backtest_buy_signal(kind: &str, config: &StrategyConfig, prices: &[Decimal]) -> bool {
    match kind {
        "simple_moving_average" | "dual_ma" | "ma_crossover" => {
            let short_period = config
                .parameters
                .get("short_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(5) as usize;
            let long_period = config
                .parameters
                .get("long_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(20) as usize;

            if prices.len() < long_period + 1 {
                return false;
            }

            let prev_short = sma(&prices[..prices.len() - 1], short_period);
            let prev_long = sma(&prices[..prices.len() - 1], long_period);
            let curr_short = sma(prices, short_period);
            let curr_long = sma(prices, long_period);

            matches!((prev_short, prev_long, curr_short, curr_long),
                (Some(ps), Some(pl), Some(cs), Some(cl)) if ps <= pl && cs > cl)
        }
        "rsi" | "rsi_strategy" => {
            let period = config
                .parameters
                .get("period")
                .and_then(|value| value.as_u64())
                .unwrap_or(14) as usize;
            let oversold = config
                .parameters
                .get("oversold")
                .and_then(|value| value.as_f64())
                .unwrap_or(30.0);

            if prices.len() < period + 2 {
                return false;
            }

            let prev = RSI::calculate(&prices[..prices.len() - 1], period)
                .and_then(|value| value.to_f64());
            let curr = RSI::calculate(prices, period).and_then(|value| value.to_f64());

            matches!((prev, curr), (Some(p), Some(c)) if p >= oversold && c < oversold)
        }
        "macd" | "macd_strategy" => {
            let fast_period = config
                .parameters
                .get("fast_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(12) as usize;
            let slow_period = config
                .parameters
                .get("slow_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(26) as usize;
            let signal_period = config
                .parameters
                .get("signal_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(9) as usize;
            if prices.len() < slow_period + signal_period + 2 {
                return false;
            }
            let macd = MACD::new(fast_period, slow_period, signal_period);
            let prev = macd
                .calculate(&prices[..prices.len() - 1])
                .map(|value| value.histogram);
            let curr = macd.calculate(prices).map(|value| value.histogram);
            matches!((prev, curr), (Some(p), Some(c)) if p <= Decimal::ZERO && c > Decimal::ZERO)
        }
        "bollinger" | "bollinger_bands" => {
            let period = config
                .parameters
                .get("period")
                .and_then(|value| value.as_u64())
                .unwrap_or(20) as usize;
            let std_dev = config
                .parameters
                .get("std_dev")
                .and_then(|value| value.as_f64())
                .unwrap_or(2.0);
            let bands = BollingerBands::new(period, std_dev);
            matches!(bands.calculate(prices), Some(result) if *prices.last().unwrap() <= result.lower_band)
        }
        "mean_reversion" => {
            let lookback = config
                .parameters
                .get("lookback_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(20) as usize;
            let threshold = config
                .parameters
                .get("threshold")
                .and_then(|value| value.as_f64())
                .unwrap_or(2.0);
            if prices.len() < lookback {
                return false;
            }
            let mean = sma(prices, lookback).unwrap_or(Decimal::ZERO);
            if mean == Decimal::ZERO {
                return false;
            }
            let recent = &prices[prices.len() - lookback..];
            let variance = recent
                .iter()
                .map(|price| (*price - mean).powi(2))
                .sum::<Decimal>()
                / Decimal::from(lookback);
            let std_dev = variance.sqrt().unwrap_or(Decimal::ZERO);
            if std_dev == Decimal::ZERO {
                return false;
            }
            let z_score = ((*prices.last().unwrap() - mean) / std_dev)
                .to_f64()
                .unwrap_or(0.0);
            z_score <= -threshold
        }
        _ => false,
    }
}

fn backtest_sell_signal(kind: &str, config: &StrategyConfig, prices: &[Decimal]) -> bool {
    match kind {
        "simple_moving_average" | "dual_ma" | "ma_crossover" => {
            let short_period = config
                .parameters
                .get("short_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(5) as usize;
            let long_period = config
                .parameters
                .get("long_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(20) as usize;

            if prices.len() < long_period + 1 {
                return false;
            }

            let prev_short = sma(&prices[..prices.len() - 1], short_period);
            let prev_long = sma(&prices[..prices.len() - 1], long_period);
            let curr_short = sma(prices, short_period);
            let curr_long = sma(prices, long_period);

            matches!((prev_short, prev_long, curr_short, curr_long),
                (Some(ps), Some(pl), Some(cs), Some(cl)) if ps >= pl && cs < cl)
        }
        "rsi" | "rsi_strategy" => {
            let period = config
                .parameters
                .get("period")
                .and_then(|value| value.as_u64())
                .unwrap_or(14) as usize;
            let overbought = config
                .parameters
                .get("overbought")
                .and_then(|value| value.as_f64())
                .unwrap_or(70.0);

            if prices.len() < period + 2 {
                return false;
            }

            let prev = RSI::calculate(&prices[..prices.len() - 1], period)
                .and_then(|value| value.to_f64());
            let curr = RSI::calculate(prices, period).and_then(|value| value.to_f64());

            matches!((prev, curr), (Some(p), Some(c)) if p <= overbought && c > overbought)
        }
        "macd" | "macd_strategy" => {
            let fast_period = config
                .parameters
                .get("fast_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(12) as usize;
            let slow_period = config
                .parameters
                .get("slow_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(26) as usize;
            let signal_period = config
                .parameters
                .get("signal_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(9) as usize;
            if prices.len() < slow_period + signal_period + 2 {
                return false;
            }
            let macd = MACD::new(fast_period, slow_period, signal_period);
            let prev = macd
                .calculate(&prices[..prices.len() - 1])
                .map(|value| value.histogram);
            let curr = macd.calculate(prices).map(|value| value.histogram);
            matches!((prev, curr), (Some(p), Some(c)) if p >= Decimal::ZERO && c < Decimal::ZERO)
        }
        "bollinger" | "bollinger_bands" => {
            let period = config
                .parameters
                .get("period")
                .and_then(|value| value.as_u64())
                .unwrap_or(20) as usize;
            let std_dev = config
                .parameters
                .get("std_dev")
                .and_then(|value| value.as_f64())
                .unwrap_or(2.0);
            let bands = BollingerBands::new(period, std_dev);
            matches!(bands.calculate(prices), Some(result) if *prices.last().unwrap() >= result.upper_band)
        }
        "mean_reversion" => {
            let lookback = config
                .parameters
                .get("lookback_period")
                .and_then(|value| value.as_u64())
                .unwrap_or(20) as usize;
            let threshold = config
                .parameters
                .get("threshold")
                .and_then(|value| value.as_f64())
                .unwrap_or(2.0);
            if prices.len() < lookback {
                return false;
            }
            let mean = sma(prices, lookback).unwrap_or(Decimal::ZERO);
            if mean == Decimal::ZERO {
                return false;
            }
            let recent = &prices[prices.len() - lookback..];
            let variance = recent
                .iter()
                .map(|price| (*price - mean).powi(2))
                .sum::<Decimal>()
                / Decimal::from(lookback);
            let std_dev = variance.sqrt().unwrap_or(Decimal::ZERO);
            if std_dev == Decimal::ZERO {
                return false;
            }
            let z_score = ((*prices.last().unwrap() - mean) / std_dev)
                .to_f64()
                .unwrap_or(0.0);
            z_score >= threshold
        }
        _ => false,
    }
}

fn calculate_sharpe_ratio(returns: &[f64]) -> f64 {
    if returns.len() < 2 {
        return 0.0;
    }
    let mean = returns.iter().sum::<f64>() / returns.len() as f64;
    let variance = returns
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / (returns.len() as f64 - 1.0);
    let std_dev = variance.sqrt();
    if std_dev <= f64::EPSILON {
        0.0
    } else {
        (mean / std_dev) * 252f64.sqrt()
    }
}

/// Sortino Ratio：只惩罚下行波动（负收益的标准差）
fn calculate_sortino_ratio(returns: &[f64]) -> f64 {
    if returns.len() < 2 {
        return 0.0;
    }
    let mean = returns.iter().sum::<f64>() / returns.len() as f64;
    let downside_variance = returns
        .iter()
        .filter(|&&r| r < 0.0)
        .map(|&r| r.powi(2))
        .sum::<f64>()
        / (returns.len() as f64);
    let downside_std = downside_variance.sqrt();
    if downside_std <= f64::EPSILON {
        0.0
    } else {
        (mean / downside_std) * 252f64.sqrt()
    }
}

/// Calmar Ratio：年化收益 / 最大回撤
fn calculate_calmar_ratio(annualized_return: f64, max_drawdown: f64) -> f64 {
    if max_drawdown <= f64::EPSILON {
        0.0
    } else {
        annualized_return / max_drawdown
    }
}

/// 历史模拟法 VaR 和 CVaR（95% 置信度）
fn calculate_var_cvar(returns: &[f64]) -> (f64, f64) {
    if returns.is_empty() {
        return (0.0, 0.0);
    }
    let mut sorted = returns.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let var_idx = ((sorted.len() as f64 * 0.05) as usize)
        .max(1)
        .min(sorted.len())
        - 1;
    let var_95 = sorted[var_idx].abs();
    let tail: Vec<f64> = sorted[..=var_idx].to_vec();
    let cvar_95 = if tail.is_empty() {
        var_95
    } else {
        tail.iter().map(|r| r.abs()).sum::<f64>() / tail.len() as f64
    };
    (var_95, cvar_95)
}

/// 计算最大连续盈利/亏损次数
fn calculate_consecutive_streaks(trades: &[ClosedTrade]) -> (i32, i32) {
    let mut max_wins = 0i32;
    let mut max_losses = 0i32;
    let mut cur_wins = 0i32;
    let mut cur_losses = 0i32;
    for trade in trades {
        if trade.pnl > Decimal::ZERO {
            cur_wins += 1;
            cur_losses = 0;
            max_wins = max_wins.max(cur_wins);
        } else if trade.pnl < Decimal::ZERO {
            cur_losses += 1;
            cur_wins = 0;
            max_losses = max_losses.max(cur_losses);
        }
    }
    (max_wins, max_losses)
}

fn calculate_max_drawdown(equity_curve: &[BacktestEquityPoint]) -> f64 {
    if equity_curve.is_empty() {
        return 0.0;
    }
    let mut peak = equity_curve[0].equity;
    let mut max_drawdown = 0.0;
    for point in equity_curve {
        if point.equity > peak {
            peak = point.equity;
        }
        if peak > Decimal::ZERO {
            let drawdown = ((point.equity - peak) / peak).to_f64().unwrap_or(0.0);
            if drawdown < max_drawdown {
                max_drawdown = drawdown;
            }
        }
    }
    max_drawdown.abs()
}

fn build_performance_metrics(
    trades: &[ClosedTrade],
    total_pnl: Decimal,
    returns: &[f64],
    annualized_return: f64,
    max_drawdown: f64,
) -> crate::types::PerformanceMetrics {
    let gross_profit: Decimal = trades
        .iter()
        .filter(|trade| trade.pnl > Decimal::ZERO)
        .map(|trade| trade.pnl)
        .sum();
    let gross_loss_abs: Decimal = trades
        .iter()
        .filter(|trade| trade.pnl < Decimal::ZERO)
        .map(|trade| trade.pnl.abs())
        .sum();
    let winners = trades
        .iter()
        .filter(|trade| trade.pnl > Decimal::ZERO)
        .map(|trade| trade.pnl)
        .collect::<Vec<_>>();
    let losers = trades
        .iter()
        .filter(|trade| trade.pnl < Decimal::ZERO)
        .map(|trade| trade.pnl)
        .collect::<Vec<_>>();

    let sortino_ratio = calculate_sortino_ratio(returns);
    let calmar_ratio = calculate_calmar_ratio(annualized_return, max_drawdown);
    let (var_95, cvar_95) = calculate_var_cvar(returns);
    let (consecutive_wins, consecutive_losses) = calculate_consecutive_streaks(trades);

    crate::types::PerformanceMetrics {
        total_pnl,
        realized_pnl: total_pnl,
        unrealized_pnl: Decimal::ZERO,
        gross_profit,
        gross_loss: gross_loss_abs,
        profit_factor: if gross_loss_abs > Decimal::ZERO {
            (gross_profit / gross_loss_abs).to_f64().unwrap_or(0.0)
        } else {
            0.0
        },
        average_win: if winners.is_empty() {
            Decimal::ZERO
        } else {
            winners.iter().copied().sum::<Decimal>() / Decimal::from(winners.len())
        },
        average_loss: if losers.is_empty() {
            Decimal::ZERO
        } else {
            losers.iter().copied().sum::<Decimal>() / Decimal::from(losers.len())
        },
        largest_win: winners.into_iter().max().unwrap_or(Decimal::ZERO),
        largest_loss: losers.into_iter().min().unwrap_or(Decimal::ZERO),
        sortino_ratio,
        calmar_ratio,
        var_95,
        cvar_95,
        avg_holding_days: 0.0,
        consecutive_wins,
        consecutive_losses,
    }
}

#[async_trait]
impl Strategy for MeanReversionStrategy {
    async fn generate_signals(&self, _market_data: &MarketData) -> AppResult<Vec<Signal>> {
        // Placeholder implementation for mean reversion strategy
        Ok(Vec::new())
    }

    async fn update_parameters(
        &mut self,
        params: HashMap<String, serde_json::Value>,
    ) -> AppResult<()> {
        for (key, value) in params {
            self.config.parameters.insert(key, value);
        }
        Ok(())
    }

    fn get_name(&self) -> &str {
        &self.config.name
    }

    fn get_description(&self) -> &str {
        self.config
            .description
            .as_deref()
            .unwrap_or("Mean Reversion Strategy")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dec(value: i64) -> Decimal {
        Decimal::from(value)
    }

    #[test]
    fn simulate_backtest_produces_metrics_for_sma_strategy() {
        let mut config = StrategyConfig::new(
            "simple_moving_average".to_string(),
            "simple_moving_average".to_string(),
        );
        config
            .parameters
            .insert("short_period".to_string(), json!(3));
        config
            .parameters
            .insert("long_period".to_string(), json!(5));
        config
            .parameters
            .insert("symbol".to_string(), json!("AAPL"));
        config
            .parameters
            .insert("timeframe".to_string(), json!("1d"));
        config
            .parameters
            .insert("initial_capital".to_string(), json!(100000));

        let prices = [
            100, 101, 102, 103, 104, 105, 106, 100, 97, 95, 93, 96, 99, 102, 105, 107,
        ];

        let history = prices
            .iter()
            .enumerate()
            .map(|(index, price)| {
                let mut bar = MarketData::new("AAPL".to_string(), dec(*price), 1000);
                bar.timestamp = Utc::now() + chrono::Duration::days(index as i64);
                bar
            })
            .collect::<Vec<_>>();

        let result = simulate_backtest("test-strategy", &config, history, Decimal::new(100000, 0))
            .expect("backtest should succeed");

        assert!(result.total_trades > 0);
        assert!(result.final_capital > Decimal::ZERO);
    }

    #[test]
    fn validate_strategy_config_normalizes_defaults() {
        let config = StrategyConfig::new(
            "strategy-1".to_string(),
            "simple_moving_average".to_string(),
        );

        let validated = validate_and_normalize_strategy_config(config)
            .expect("default strategy config should be normalized");

        assert_eq!(validated.name, "simple_moving_average");
        assert_eq!(
            validated
                .parameters
                .get("symbol")
                .and_then(|value| value.as_str()),
            Some("AAPL")
        );
        assert_eq!(
            validated
                .parameters
                .get("initial_capital")
                .and_then(|value| value.as_f64()),
            Some(100000.0)
        );
    }

    #[test]
    fn validate_strategy_config_preserves_custom_display_name() {
        let mut config = StrategyConfig::new(
            "strategy-1".to_string(),
            "simple_moving_average".to_string(),
        );
        config.display_name = Some("My SMA".to_string());

        let validated = validate_and_normalize_strategy_config(config)
            .expect("custom display name should be accepted");

        assert_eq!(validated.display_name.as_deref(), Some("My SMA"));
    }

    #[test]
    fn validate_strategy_config_rejects_invalid_period_order() {
        let mut config = StrategyConfig::new(
            "strategy-2".to_string(),
            "simple_moving_average".to_string(),
        );
        config
            .parameters
            .insert("short_period".to_string(), json!(20));
        config
            .parameters
            .insert("long_period".to_string(), json!(5));

        let error = validate_and_normalize_strategy_config(config)
            .expect_err("invalid MA periods should be rejected");
        assert!(error
            .to_string()
            .contains("short_period must be smaller than long_period"));
    }

    #[test]
    fn simulate_backtest_costs_reduce_capital() {
        let mut base = StrategyConfig::new(
            "strategy-3".to_string(),
            "simple_moving_average".to_string(),
        );
        base.parameters.insert("short_period".to_string(), json!(3));
        base.parameters.insert("long_period".to_string(), json!(5));
        base.parameters.insert("symbol".to_string(), json!("AAPL"));
        base.parameters.insert("timeframe".to_string(), json!("1d"));
        base.parameters
            .insert("initial_capital".to_string(), json!(100000));
        base.parameters.insert("fee_bps".to_string(), json!(0.0));
        base.parameters
            .insert("slippage_bps".to_string(), json!(0.0));
        base.parameters
            .insert("max_position_fraction".to_string(), json!(1.0));

        let mut costly = base.clone();
        costly.parameters.insert("fee_bps".to_string(), json!(25.0));
        costly
            .parameters
            .insert("slippage_bps".to_string(), json!(15.0));
        costly
            .parameters
            .insert("max_position_fraction".to_string(), json!(0.5));

        let prices = [
            100, 101, 102, 103, 104, 105, 106, 100, 97, 95, 93, 96, 99, 102, 105, 107,
        ];

        let history = prices
            .iter()
            .enumerate()
            .map(|(index, price)| {
                let mut bar = MarketData::new("AAPL".to_string(), dec(*price), 1000);
                bar.timestamp = Utc::now() + chrono::Duration::days(index as i64);
                bar
            })
            .collect::<Vec<_>>();

        let frictionless = simulate_backtest(
            "test-strategy",
            &base,
            history.clone(),
            Decimal::new(100000, 0),
        )
        .expect("frictionless backtest should succeed");
        let with_costs =
            simulate_backtest("test-strategy", &costly, history, Decimal::new(100000, 0))
                .expect("cost-aware backtest should succeed");

        assert!(with_costs.final_capital < frictionless.final_capital);
    }

    #[test]
    fn strategy_related_cleanup_tables_cover_all_associations() {
        let tables = strategy_related_cleanup_tables();
        assert!(tables.contains(&"trades_archive"));
        assert!(tables.contains(&"orders_archive"));
        assert!(tables.contains(&"backtest_runs"));
        assert!(tables.contains(&"performance_metrics"));
        assert!(tables.contains(&"trades"));
        assert!(tables.contains(&"orders"));
    }

    #[test]
    fn attach_strategy_context_to_backtest_result_uses_current_snapshot() {
        let mut config = StrategyConfig::new(
            "strategy-4".to_string(),
            "simple_moving_average".to_string(),
        );
        config.display_name = Some("SMA Alpha".to_string());
        config
            .parameters
            .insert("symbol".to_string(), json!("0700.HK"));
        config
            .parameters
            .insert("timeframe".to_string(), json!("1h"));
        config
            .parameters
            .insert("short_period".to_string(), json!(8));
        config
            .parameters
            .insert("long_period".to_string(), json!(21));

        let result = BacktestResult {
            run_id: None,
            strategy_id: config.id.clone(),
            strategy_name: None,
            symbol: None,
            timeframe: None,
            parameters: None,
            trades: None,
            equity_curve: None,
            start_date: Utc::now(),
            end_date: Utc::now(),
            initial_capital: Decimal::new(100000, 0),
            final_capital: Decimal::new(100000, 0),
            total_return: 0.0,
            annualized_return: 0.0,
            sharpe_ratio: 0.0,
            max_drawdown: 0.0,
            win_rate: 0.0,
            total_trades: 0,
            performance_metrics: crate::types::PerformanceMetrics::default(),
            created_at: None,
        };

        let snapshot = attach_strategy_context_to_backtest_result(result, &config);

        assert_eq!(snapshot.strategy_name.as_deref(), Some("SMA Alpha"));
        assert_eq!(snapshot.symbol.as_deref(), Some("0700.HK"));
        assert_eq!(snapshot.timeframe.as_deref(), Some("1h"));
        assert_eq!(
            snapshot
                .parameters
                .as_ref()
                .and_then(|params| params.get("short_period"))
                .and_then(|value| value.as_i64()),
            Some(8)
        );
    }

    #[test]
    fn attach_strategy_context_to_backtest_result_falls_back_to_defaults() {
        let config = StrategyConfig::new(
            "strategy-5".to_string(),
            "simple_moving_average".to_string(),
        );
        let result = BacktestResult {
            run_id: None,
            strategy_id: config.id.clone(),
            strategy_name: None,
            symbol: None,
            timeframe: None,
            parameters: None,
            trades: None,
            equity_curve: None,
            start_date: Utc::now(),
            end_date: Utc::now(),
            initial_capital: Decimal::new(100000, 0),
            final_capital: Decimal::new(100000, 0),
            total_return: 0.0,
            annualized_return: 0.0,
            sharpe_ratio: 0.0,
            max_drawdown: 0.0,
            win_rate: 0.0,
            total_trades: 0,
            performance_metrics: crate::types::PerformanceMetrics::default(),
            created_at: None,
        };

        let snapshot = attach_strategy_context_to_backtest_result(result, &config);

        assert_eq!(snapshot.symbol.as_deref(), Some("AAPL"));
        assert_eq!(snapshot.timeframe.as_deref(), Some("1d"));
    }
}
