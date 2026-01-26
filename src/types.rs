use chrono::{DateTime, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Market data structure for real-time and historical price data
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MarketData {
    pub symbol: String,
    pub timestamp: DateTime<Utc>,
    pub price: Decimal,
    pub volume: i64,
    pub bid_price: Option<Decimal>,
    pub ask_price: Option<Decimal>,
    pub bid_size: Option<i64>,
    pub ask_size: Option<i64>,
    pub open_price: Option<Decimal>,
    pub high_price: Option<Decimal>,
    pub low_price: Option<Decimal>,
    pub previous_close: Option<Decimal>,
    pub market_cap: Option<Decimal>,
    pub pe_ratio: Option<f64>,
    pub data_source: Option<String>,
    pub exchange: Option<String>,
}

impl MarketData {
    pub fn new(symbol: String, price: Decimal, volume: i64) -> Self {
        Self {
            symbol,
            timestamp: Utc::now(),
            price,
            volume,
            bid_price: None,
            ask_price: None,
            bid_size: None,
            ask_size: None,
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

    pub fn with_bid_ask(
        mut self,
        bid_price: Decimal,
        ask_price: Decimal,
        bid_size: i64,
        ask_size: i64,
    ) -> Self {
        self.bid_price = Some(bid_price);
        self.ask_price = Some(ask_price);
        self.bid_size = Some(bid_size);
        self.ask_size = Some(ask_size);
        self
    }

    pub fn with_ohlc(
        mut self,
        open: Decimal,
        high: Decimal,
        low: Decimal,
        previous_close: Decimal,
    ) -> Self {
        self.open_price = Some(open);
        self.high_price = Some(high);
        self.low_price = Some(low);
        self.previous_close = Some(previous_close);
        self
    }

    pub fn with_fundamentals(mut self, market_cap: Decimal, pe_ratio: f64) -> Self {
        self.market_cap = Some(market_cap);
        self.pe_ratio = Some(pe_ratio);
        self
    }

    pub fn with_source(mut self, data_source: String, exchange: String) -> Self {
        self.data_source = Some(data_source);
        self.exchange = Some(exchange);
        self
    }

    /// Calculate price change from previous close
    pub fn price_change(&self) -> Option<Decimal> {
        self.previous_close.map(|prev| self.price - prev)
    }

    /// Calculate price change percentage
    pub fn price_change_percent(&self) -> Option<f64> {
        self.previous_close.and_then(|prev| {
            if prev > Decimal::ZERO {
                let change = self.price - prev;
                (change / prev * Decimal::from(100)).to_f64()
            } else {
                None
            }
        })
    }

    /// Calculate bid-ask spread
    pub fn bid_ask_spread(&self) -> Option<Decimal> {
        match (self.bid_price, self.ask_price) {
            (Some(bid), Some(ask)) => Some(ask - bid),
            _ => None,
        }
    }

    /// Calculate bid-ask spread percentage
    pub fn bid_ask_spread_percent(&self) -> Option<f64> {
        self.bid_ask_spread().and_then(|spread| {
            if self.price > Decimal::ZERO {
                (spread / self.price * Decimal::from(100)).to_f64()
            } else {
                None
            }
        })
    }

    /// Check if this is a valid trading price
    pub fn is_valid_price(&self) -> bool {
        self.price > Decimal::ZERO
            && self.volume >= 0
            && self
                .bid_ask_spread()
                .map_or(true, |spread| spread >= Decimal::ZERO)
    }
}

/// Enhanced market data event with additional context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataEvent {
    pub id: Uuid,
    pub event_type: DataEventType,
    pub symbol: String,
    pub timestamp: DateTime<Utc>,
    pub data: MarketData,
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DataEventType {
    RealTimeQuote,
    HistoricalData,
    TradeExecution,
    OrderBookUpdate,
    NewsUpdate,
    FundamentalUpdate,
}

impl DataEvent {
    pub fn new(event_type: DataEventType, data: MarketData) -> Self {
        Self {
            id: Uuid::new_v4(),
            event_type,
            symbol: data.symbol.clone(),
            timestamp: Utc::now(),
            data,
            metadata: HashMap::new(),
        }
    }

    pub fn with_metadata(mut self, key: String, value: serde_json::Value) -> Self {
        self.metadata.insert(key, value);
        self
    }
}

/// Candlestick/OHLCV data for charting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandlestickData {
    pub symbol: String,
    pub timestamp: DateTime<Utc>,
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    pub volume: i64,
    pub vwap: Option<Decimal>, // Volume Weighted Average Price
    pub trades_count: Option<i32>,
}

impl CandlestickData {
    pub fn new(
        symbol: String,
        open: Decimal,
        high: Decimal,
        low: Decimal,
        close: Decimal,
        volume: i64,
    ) -> Self {
        Self {
            symbol,
            timestamp: Utc::now(),
            open,
            high,
            low,
            close,
            volume,
            vwap: None,
            trades_count: None,
        }
    }

    pub fn with_vwap(mut self, vwap: Decimal, trades_count: i32) -> Self {
        self.vwap = Some(vwap);
        self.trades_count = Some(trades_count);
        self
    }

    /// Calculate price range (high - low)
    pub fn price_range(&self) -> Decimal {
        self.high - self.low
    }

    /// Calculate body size (|close - open|)
    pub fn body_size(&self) -> Decimal {
        (self.close - self.open).abs()
    }

    /// Check if this is a bullish candle
    pub fn is_bullish(&self) -> bool {
        self.close > self.open
    }

    /// Check if this is a bearish candle
    pub fn is_bearish(&self) -> bool {
        self.close < self.open
    }

    /// Check if this is a doji (open ≈ close)
    pub fn is_doji(&self, threshold_percent: f64) -> bool {
        if self.open == Decimal::ZERO {
            return false;
        }
        let body_percent = ((self.close - self.open).abs() / self.open * Decimal::from(100))
            .to_f64()
            .unwrap_or(100.0);
        body_percent <= threshold_percent
    }
}

/// Order book level data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookLevel {
    pub price: Decimal,
    pub size: i64,
    pub orders_count: Option<i32>,
}

/// Full order book snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub timestamp: DateTime<Utc>,
    pub bids: Vec<OrderBookLevel>,
    pub asks: Vec<OrderBookLevel>,
    pub sequence: Option<i64>,
}

impl OrderBook {
    pub fn new(symbol: String) -> Self {
        Self {
            symbol,
            timestamp: Utc::now(),
            bids: Vec::new(),
            asks: Vec::new(),
            sequence: None,
        }
    }

    /// Get best bid price
    pub fn best_bid(&self) -> Option<Decimal> {
        self.bids.first().map(|level| level.price)
    }

    /// Get best ask price
    pub fn best_ask(&self) -> Option<Decimal> {
        self.asks.first().map(|level| level.price)
    }

    /// Calculate bid-ask spread
    pub fn spread(&self) -> Option<Decimal> {
        match (self.best_bid(), self.best_ask()) {
            (Some(bid), Some(ask)) => Some(ask - bid),
            _ => None,
        }
    }

    /// Calculate total bid volume
    pub fn total_bid_volume(&self) -> i64 {
        self.bids.iter().map(|level| level.size).sum()
    }

    /// Calculate total ask volume
    pub fn total_ask_volume(&self) -> i64 {
        self.asks.iter().map(|level| level.size).sum()
    }

    /// Calculate order book imbalance (bid_volume - ask_volume) / (bid_volume + ask_volume)
    pub fn imbalance(&self) -> Option<f64> {
        let bid_vol = self.total_bid_volume();
        let ask_vol = self.total_ask_volume();
        let total_vol = bid_vol + ask_vol;

        if total_vol > 0 {
            Some((bid_vol - ask_vol) as f64 / total_vol as f64)
        } else {
            None
        }
    }
}

/// Trading signal types
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum SignalType {
    Buy,
    Sell,
    Hold,
}

/// Trading signal generated by strategies
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    pub id: Uuid,
    pub strategy_id: String,
    pub symbol: String,
    pub signal_type: SignalType,
    pub strength: f64, // 0.0 to 1.0
    pub timestamp: DateTime<Utc>,
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Signal {
    pub fn new(
        strategy_id: String,
        symbol: String,
        signal_type: SignalType,
        strength: f64,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            strategy_id,
            symbol,
            signal_type,
            strength: strength.clamp(0.0, 1.0),
            timestamp: Utc::now(),
            metadata: HashMap::new(),
        }
    }

    pub fn with_metadata(mut self, metadata: HashMap<String, serde_json::Value>) -> Self {
        self.metadata = metadata;
        self
    }
}

/// Order status enumeration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum OrderStatus {
    Pending,
    Submitted,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

/// Order type enumeration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum OrderType {
    Market,
    Limit,
    Stop,
    StopLimit,
}

/// Order side enumeration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum OrderSide {
    Buy,
    Sell,
}

/// Trading order structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: Uuid,
    pub symbol: String,
    pub side: OrderSide,
    pub quantity: i64,
    pub price: Option<Decimal>,
    pub order_type: OrderType,
    pub status: OrderStatus,
    pub strategy_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub filled_quantity: i64,
    pub average_fill_price: Option<Decimal>,
}

impl Order {
    pub fn new(symbol: String, side: OrderSide, quantity: i64, order_type: OrderType) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            symbol,
            side,
            quantity,
            price: None,
            order_type,
            status: OrderStatus::Pending,
            strategy_id: None,
            created_at: now,
            updated_at: now,
            filled_quantity: 0,
            average_fill_price: None,
        }
    }

    pub fn with_price(mut self, price: Decimal) -> Self {
        self.price = Some(price);
        self
    }

    pub fn with_strategy(mut self, strategy_id: String) -> Self {
        self.strategy_id = Some(strategy_id);
        self
    }
}

/// Position structure for portfolio management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub symbol: String,
    pub quantity: i64,
    pub average_cost: Decimal,
    pub market_value: Decimal,
    pub unrealized_pnl: Decimal,
    pub realized_pnl: Decimal,
    pub last_updated: DateTime<Utc>,
}

impl Position {
    pub fn new(symbol: String, quantity: i64, average_cost: Decimal) -> Self {
        Self {
            symbol,
            quantity,
            average_cost,
            market_value: Decimal::ZERO,
            unrealized_pnl: Decimal::ZERO,
            realized_pnl: Decimal::ZERO,
            last_updated: Utc::now(),
        }
    }

    pub fn update_market_value(&mut self, current_price: Decimal) {
        self.market_value = current_price * Decimal::from(self.quantity.abs());
        self.unrealized_pnl =
            self.market_value - (self.average_cost * Decimal::from(self.quantity.abs()));
        self.last_updated = Utc::now();
    }
}

/// Strategy configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyConfig {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub parameters: HashMap<String, serde_json::Value>,
    pub risk_limits: RiskLimits,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl StrategyConfig {
    pub fn new(id: String, name: String) -> Self {
        let now = Utc::now();
        Self {
            id,
            name,
            description: None,
            parameters: HashMap::new(),
            risk_limits: RiskLimits::default(),
            is_active: true,
            created_at: now,
            updated_at: now,
        }
    }
}

/// Risk limits configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskLimits {
    pub max_position_size: Option<Decimal>,
    pub max_daily_loss: Option<Decimal>,
    pub max_portfolio_exposure: Option<Decimal>,
    pub max_single_stock_weight: Option<f64>,
}

impl Default for RiskLimits {
    fn default() -> Self {
        Self {
            max_position_size: None,
            max_daily_loss: None,
            max_portfolio_exposure: None,
            max_single_stock_weight: None,
        }
    }
}

/// Portfolio summary structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Portfolio {
    pub id: String,
    pub name: String,
    pub positions: HashMap<String, Position>,
    pub cash_balance: Decimal,
    pub total_value: Decimal,
    pub unrealized_pnl: Decimal,
    pub realized_pnl: Decimal,
    pub last_updated: DateTime<Utc>,
}

impl Portfolio {
    pub fn new(id: String, name: String, initial_cash: Decimal) -> Self {
        Self {
            id,
            name,
            positions: HashMap::new(),
            cash_balance: initial_cash,
            total_value: initial_cash,
            unrealized_pnl: Decimal::ZERO,
            realized_pnl: Decimal::ZERO,
            last_updated: Utc::now(),
        }
    }

    pub fn calculate_total_value(&mut self) {
        let positions_value: Decimal = self.positions.values().map(|pos| pos.market_value).sum();

        self.total_value = self.cash_balance + positions_value;
        self.unrealized_pnl = self.positions.values().map(|pos| pos.unrealized_pnl).sum();

        self.last_updated = Utc::now();
    }
}

/// Risk metrics structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskMetrics {
    pub portfolio_value: Decimal,
    pub total_exposure: Decimal,
    pub leverage: f64,
    pub var_1d: Option<Decimal>,
    pub max_drawdown: Option<f64>,
    pub sharpe_ratio: Option<f64>,
    pub calculated_at: DateTime<Utc>,
}

impl RiskMetrics {
    pub fn new(portfolio_value: Decimal, total_exposure: Decimal) -> Self {
        let leverage = if portfolio_value > Decimal::ZERO {
            (total_exposure / portfolio_value).to_f64().unwrap_or(0.0)
        } else {
            0.0
        };

        Self {
            portfolio_value,
            total_exposure,
            leverage,
            var_1d: None,
            max_drawdown: None,
            sharpe_ratio: None,
            calculated_at: Utc::now(),
        }
    }
}

/// Backtest result structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestResult {
    pub strategy_id: String,
    pub start_date: DateTime<Utc>,
    pub end_date: DateTime<Utc>,
    pub initial_capital: Decimal,
    pub final_capital: Decimal,
    pub total_return: f64,
    pub annualized_return: f64,
    pub sharpe_ratio: f64,
    pub max_drawdown: f64,
    pub win_rate: f64,
    pub total_trades: i32,
    pub performance_metrics: PerformanceMetrics,
}

/// Performance metrics structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub total_pnl: Decimal,
    pub realized_pnl: Decimal,
    pub unrealized_pnl: Decimal,
    pub gross_profit: Decimal,
    pub gross_loss: Decimal,
    pub profit_factor: f64,
    pub average_win: Decimal,
    pub average_loss: Decimal,
    pub largest_win: Decimal,
    pub largest_loss: Decimal,
}

impl Default for PerformanceMetrics {
    fn default() -> Self {
        Self {
            total_pnl: Decimal::ZERO,
            realized_pnl: Decimal::ZERO,
            unrealized_pnl: Decimal::ZERO,
            gross_profit: Decimal::ZERO,
            gross_loss: Decimal::ZERO,
            profit_factor: 0.0,
            average_win: Decimal::ZERO,
            average_loss: Decimal::ZERO,
            largest_win: Decimal::ZERO,
            largest_loss: Decimal::ZERO,
        }
    }
}
