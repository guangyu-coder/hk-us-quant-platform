use crate::error::{AppError, AppResult};
use crate::types::{Order, OrderStatus};
use async_trait::async_trait;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::info;

pub mod alpaca;

/// Broker trait for implementing different broker integrations
#[async_trait]
pub trait Broker: Send + Sync {
    /// Get broker name
    fn name(&self) -> &str;

    /// Check if broker is connected
    async fn is_connected(&self) -> bool;

    /// Get account information
    async fn get_account(&self) -> AppResult<BrokerAccount>;

    /// Submit an order
    async fn submit_order(&self, order: &Order) -> AppResult<BrokerOrderResult>;

    /// Cancel an order
    async fn cancel_order(&self, broker_order_id: &str) -> AppResult<()>;

    /// Get order status
    async fn get_order_status(&self, broker_order_id: &str) -> AppResult<BrokerOrderStatus>;

    /// Get all positions
    async fn get_positions(&self) -> AppResult<Vec<BrokerPosition>>;

    /// Get position for a specific symbol
    async fn get_position(&self, symbol: &str) -> AppResult<Option<BrokerPosition>>;

    /// Get market data quote
    async fn get_quote(&self, symbol: &str) -> AppResult<BrokerQuote>;

    /// Get multiple quotes
    async fn get_quotes(&self, symbols: &[String]) -> AppResult<HashMap<String, BrokerQuote>>;
}

/// Broker account information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerAccount {
    pub account_id: String,
    pub status: String,
    pub currency: String,
    pub cash: Decimal,
    pub portfolio_value: Decimal,
    pub buying_power: Decimal,
    pub equity: Decimal,
    pub last_equity: Decimal,
    pub long_market_value: Decimal,
    pub short_market_value: Decimal,
    pub initial_margin: Decimal,
    pub maintenance_margin: Decimal,
    pub daytrade_count: i32,
    pub pattern_day_trader: bool,
    pub trading_blocked: bool,
    pub transfers_blocked: bool,
    pub account_blocked: bool,
}

/// Result of submitting an order to broker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerOrderResult {
    pub broker_order_id: String,
    pub client_order_id: String,
    pub status: BrokerOrderStatus,
    pub submitted_at: chrono::DateTime<chrono::Utc>,
}

/// Broker order status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BrokerOrderStatus {
    New,
    Accepted,
    PendingNew,
    PartiallyFilled,
    Filled,
    DoneForDay,
    Cancelled,
    Expired,
    Replaced,
    PendingCancel,
    PendingReplace,
    Rejected,
    Stopped,
    Suspended,
    Calculated,
    Held,
    Unknown(String),
}

impl BrokerOrderStatus {
    pub fn to_order_status(&self) -> OrderStatus {
        match self {
            BrokerOrderStatus::New
            | BrokerOrderStatus::Accepted
            | BrokerOrderStatus::PendingNew => OrderStatus::Submitted,
            BrokerOrderStatus::PartiallyFilled => OrderStatus::PartiallyFilled,
            BrokerOrderStatus::Filled | BrokerOrderStatus::DoneForDay => OrderStatus::Filled,
            BrokerOrderStatus::Cancelled
            | BrokerOrderStatus::Expired
            | BrokerOrderStatus::Replaced => OrderStatus::Cancelled,
            BrokerOrderStatus::Rejected
            | BrokerOrderStatus::Stopped
            | BrokerOrderStatus::Suspended => OrderStatus::Rejected,
            _ => OrderStatus::Pending,
        }
    }
}

/// Broker position information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerPosition {
    pub symbol: String,
    pub quantity: i64,
    pub side: String,
    pub market_value: Decimal,
    pub cost_basis: Decimal,
    pub unrealized_pl: Decimal,
    pub unrealized_plpc: Decimal,
    pub current_price: Decimal,
    pub avg_entry_price: Decimal,
    pub change_today: Decimal,
}

/// Broker quote data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerQuote {
    pub symbol: String,
    pub bid_price: Decimal,
    pub bid_size: i64,
    pub ask_price: Decimal,
    pub ask_size: i64,
    pub last_price: Decimal,
    pub last_size: i64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// Broker configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerConfig {
    pub provider: BrokerProvider,
    pub api_key: String,
    pub api_secret: String,
    pub base_url: Option<String>,
    pub paper_trading: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BrokerProvider {
    Alpaca,
    InteractiveBrokers,
    Mock,
}

impl Default for BrokerConfig {
    fn default() -> Self {
        Self {
            provider: BrokerProvider::Mock,
            api_key: String::new(),
            api_secret: String::new(),
            base_url: None,
            paper_trading: true,
        }
    }
}

/// Create broker instance based on configuration
pub async fn create_broker(config: &BrokerConfig) -> AppResult<Box<dyn Broker>> {
    match config.provider {
        BrokerProvider::Alpaca => {
            let broker = alpaca::AlpacaBroker::new(config).await?;
            Ok(Box::new(broker))
        }
        BrokerProvider::Mock => {
            let broker = MockBroker::new();
            Ok(Box::new(broker))
        }
        BrokerProvider::InteractiveBrokers => Err(AppError::broker(
            "Interactive Brokers integration not yet implemented",
        )),
    }
}

/// Mock broker for testing and paper trading
pub struct MockBroker {
    positions: tokio::sync::RwLock<HashMap<String, BrokerPosition>>,
    orders: tokio::sync::RwLock<HashMap<String, BrokerOrderStatus>>,
}

impl MockBroker {
    pub fn new() -> Self {
        Self {
            positions: tokio::sync::RwLock::new(HashMap::new()),
            orders: tokio::sync::RwLock::new(HashMap::new()),
        }
    }
}

#[async_trait]
impl Broker for MockBroker {
    fn name(&self) -> &str {
        "Mock Broker"
    }

    async fn is_connected(&self) -> bool {
        true
    }

    async fn get_account(&self) -> AppResult<BrokerAccount> {
        Ok(BrokerAccount {
            account_id: "mock-account".to_string(),
            status: "ACTIVE".to_string(),
            currency: "USD".to_string(),
            cash: Decimal::new(100000, 2),
            portfolio_value: Decimal::new(100000, 2),
            buying_power: Decimal::new(400000, 2),
            equity: Decimal::new(100000, 2),
            last_equity: Decimal::new(99500, 2),
            long_market_value: Decimal::ZERO,
            short_market_value: Decimal::ZERO,
            initial_margin: Decimal::ZERO,
            maintenance_margin: Decimal::ZERO,
            daytrade_count: 0,
            pattern_day_trader: false,
            trading_blocked: false,
            transfers_blocked: false,
            account_blocked: false,
        })
    }

    async fn submit_order(&self, order: &Order) -> AppResult<BrokerOrderResult> {
        let broker_order_id = uuid::Uuid::new_v4().to_string();

        let mut orders = self.orders.write().await;
        orders.insert(broker_order_id.clone(), BrokerOrderStatus::Filled);

        info!(
            "Mock broker: Order {} submitted and filled",
            broker_order_id
        );

        Ok(BrokerOrderResult {
            broker_order_id,
            client_order_id: order.id.to_string(),
            status: BrokerOrderStatus::Filled,
            submitted_at: chrono::Utc::now(),
        })
    }

    async fn cancel_order(&self, broker_order_id: &str) -> AppResult<()> {
        let mut orders = self.orders.write().await;
        orders.insert(broker_order_id.to_string(), BrokerOrderStatus::Cancelled);
        Ok(())
    }

    async fn get_order_status(&self, broker_order_id: &str) -> AppResult<BrokerOrderStatus> {
        let orders = self.orders.read().await;
        Ok(orders
            .get(broker_order_id)
            .cloned()
            .unwrap_or(BrokerOrderStatus::Unknown("Not found".to_string())))
    }

    async fn get_positions(&self) -> AppResult<Vec<BrokerPosition>> {
        let positions = self.positions.read().await;
        Ok(positions.values().cloned().collect())
    }

    async fn get_position(&self, symbol: &str) -> AppResult<Option<BrokerPosition>> {
        let positions = self.positions.read().await;
        Ok(positions.get(symbol).cloned())
    }

    async fn get_quote(&self, symbol: &str) -> AppResult<BrokerQuote> {
        let base_price = match symbol {
            "AAPL" => Decimal::new(15000, 2),
            "GOOGL" => Decimal::new(280000, 2),
            "MSFT" => Decimal::new(38000, 2),
            "TSLA" => Decimal::new(25000, 2),
            _ => Decimal::new(10000, 2),
        };

        Ok(BrokerQuote {
            symbol: symbol.to_string(),
            bid_price: base_price - Decimal::new(10, 2),
            bid_size: 100,
            ask_price: base_price + Decimal::new(10, 2),
            ask_size: 100,
            last_price: base_price,
            last_size: 50,
            timestamp: chrono::Utc::now(),
        })
    }

    async fn get_quotes(&self, symbols: &[String]) -> AppResult<HashMap<String, BrokerQuote>> {
        let mut quotes = HashMap::new();
        for symbol in symbols {
            quotes.insert(symbol.clone(), self.get_quote(symbol).await?);
        }
        Ok(quotes)
    }
}
