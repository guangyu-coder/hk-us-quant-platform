use crate::error::{AppError, AppResult};
use crate::events::{EventBus, PlatformEvent};
use crate::types::{BacktestResult, MarketData, Signal, StrategyConfig};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rust_decimal::prelude::ToPrimitive;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

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
        info!("Loading strategy: {} ({})", config.name, config.id);

        // Store strategy configuration in database
        let query = r#"
            INSERT INTO strategies (strategy_id, name, description, config, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (strategy_id) DO UPDATE SET
                name = EXCLUDED.name,
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
                    "Strategy {} ({}) stored but not loaded in memory",
                    config.name, config.id
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

        // This is a placeholder implementation
        // In a real system, this would:
        // 1. Fetch historical data for the time period
        // 2. Run the strategy against historical data
        // 3. Calculate performance metrics
        // 4. Return comprehensive backtest results

        let result = BacktestResult {
            strategy_id: strategy_id.to_string(),
            start_date: start,
            end_date: end,
            initial_capital: rust_decimal::Decimal::new(100000, 2), // $1000.00
            final_capital: rust_decimal::Decimal::new(110000, 2),   // $1100.00
            total_return: 0.10,                                     // 10%
            annualized_return: 0.12,                                // 12%
            sharpe_ratio: 1.5,
            max_drawdown: 0.05, // 5%
            win_rate: 0.65,     // 65%
            total_trades: 100,
            performance_metrics: Default::default(),
        };

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

    /// Create strategy instance based on configuration
    fn create_strategy_instance(&self, config: &StrategyConfig) -> AppResult<Box<dyn Strategy>> {
        // This is a placeholder - in a real system, this would use a factory pattern
        // to create different strategy types based on the configuration

        match config.name.as_str() {
            "simple_moving_average" => {
                Ok(Box::new(SimpleMovingAverageStrategy::new(config.clone())?))
            }
            "mean_reversion" => Ok(Box::new(MeanReversionStrategy::new(config.clone())?)),
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
            SELECT strategy_id, name, description, config, is_active, created_at, updated_at
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
            SELECT strategy_id, name, description, config, is_active, created_at, updated_at
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
}

#[derive(sqlx::FromRow)]
struct StrategyRow {
    strategy_id: String,
    name: String,
    description: Option<String>,
    config: serde_json::Value,
    is_active: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<StrategyRow> for StrategyConfig {
    fn from(row: StrategyRow) -> Self {
        let parameters = row
            .config
            .as_object()
            .map(|obj| obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();

        StrategyConfig {
            id: row.strategy_id,
            name: row.name,
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
