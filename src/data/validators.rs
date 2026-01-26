use crate::error::ValidationResult;
use crate::types::{CandlestickData, MarketData, OrderBook};
use chrono::{Duration, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use std::collections::HashSet;

/// Enhanced data validator for comprehensive market data quality checks
pub struct DataValidator {
    valid_symbols: HashSet<String>,
    min_price: Decimal,
    max_price: Decimal,
    max_volume: i64,
    max_price_change_percent: f64,
    max_spread_percent: f64,
    exchange_configs: std::collections::HashMap<String, ExchangeConfig>,
}

#[derive(Debug, Clone)]
pub struct ExchangeConfig {
    pub name: String,
    pub trading_hours: TradingHours,
    pub tick_size: Decimal,
    pub min_order_size: i64,
    pub max_order_size: i64,
}

#[derive(Debug, Clone)]
pub struct TradingHours {
    pub market_open: chrono::NaiveTime,
    pub market_close: chrono::NaiveTime,
    pub timezone: String,
}

impl DataValidator {
    pub fn new() -> Self {
        // Initialize with some common symbols for validation
        let mut valid_symbols = HashSet::new();

        // HK stocks
        valid_symbols.insert("0700.HK".to_string()); // Tencent
        valid_symbols.insert("0941.HK".to_string()); // China Mobile
        valid_symbols.insert("1299.HK".to_string()); // AIA
        valid_symbols.insert("2318.HK".to_string()); // Ping An
        valid_symbols.insert("3690.HK".to_string()); // Meituan

        // US stocks
        valid_symbols.insert("AAPL".to_string());
        valid_symbols.insert("GOOGL".to_string());
        valid_symbols.insert("MSFT".to_string());
        valid_symbols.insert("TSLA".to_string());
        valid_symbols.insert("AMZN".to_string());
        valid_symbols.insert("META".to_string());
        valid_symbols.insert("NVDA".to_string());

        // Initialize exchange configurations
        let mut exchange_configs = std::collections::HashMap::new();

        // NASDAQ configuration
        exchange_configs.insert(
            "NASDAQ".to_string(),
            ExchangeConfig {
                name: "NASDAQ".to_string(),
                trading_hours: TradingHours {
                    market_open: chrono::NaiveTime::from_hms_opt(9, 30, 0).unwrap(),
                    market_close: chrono::NaiveTime::from_hms_opt(16, 0, 0).unwrap(),
                    timezone: "America/New_York".to_string(),
                },
                tick_size: Decimal::new(1, 2), // $0.01
                min_order_size: 1,
                max_order_size: 1_000_000,
            },
        );

        // HKEX configuration
        exchange_configs.insert(
            "HKEX".to_string(),
            ExchangeConfig {
                name: "HKEX".to_string(),
                trading_hours: TradingHours {
                    market_open: chrono::NaiveTime::from_hms_opt(9, 30, 0).unwrap(),
                    market_close: chrono::NaiveTime::from_hms_opt(16, 0, 0).unwrap(),
                    timezone: "Asia/Hong_Kong".to_string(),
                },
                tick_size: Decimal::new(1, 3), // HK$0.001
                min_order_size: 100,
                max_order_size: 10_000_000,
            },
        );

        Self {
            valid_symbols,
            min_price: Decimal::new(1, 4),       // 0.0001
            max_price: Decimal::new(1000000, 2), // 10000.00
            max_volume: 1_000_000_000,           // 1 billion shares
            max_price_change_percent: 50.0,      // 50% max price change
            max_spread_percent: 10.0,            // 10% max spread
            exchange_configs,
        }
    }

    /// Comprehensive market data validation
    pub fn validate(&self, data: &MarketData) -> ValidationResult {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        // Basic validation
        self.validate_basic_fields(data, &mut errors, &mut warnings);

        // Price validation
        self.validate_price_data(data, &mut errors, &mut warnings);

        // Volume validation
        self.validate_volume_data(data, &mut errors, &mut warnings);

        // Bid/Ask validation
        self.validate_bid_ask_data(data, &mut errors, &mut warnings);

        // Timestamp validation
        self.validate_timestamp(data, &mut errors, &mut warnings);

        // Symbol and exchange validation
        self.validate_symbol_and_exchange(data, &mut errors, &mut warnings);

        // Market hours validation
        self.validate_market_hours(data, &mut errors, &mut warnings);

        // Price change validation
        self.validate_price_changes(data, &mut errors, &mut warnings);

        // Return validation result
        if !errors.is_empty() {
            ValidationResult::Invalid { reasons: errors }
        } else if !warnings.is_empty() {
            ValidationResult::Warning { reasons: warnings }
        } else {
            ValidationResult::Valid
        }
    }

    /// Validate candlestick data
    pub fn validate_candlestick(&self, data: &CandlestickData) -> ValidationResult {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        // Basic OHLC validation
        if data.high < data.low {
            errors.push("High price cannot be less than low price".to_string());
        }

        if data.open < Decimal::ZERO
            || data.high < Decimal::ZERO
            || data.low < Decimal::ZERO
            || data.close < Decimal::ZERO
        {
            errors.push("OHLC prices must be positive".to_string());
        }

        if data.open > data.high || data.open < data.low {
            errors.push("Open price must be within high-low range".to_string());
        }

        if data.close > data.high || data.close < data.low {
            errors.push("Close price must be within high-low range".to_string());
        }

        if data.volume < 0 {
            errors.push("Volume cannot be negative".to_string());
        }

        // Check for suspicious patterns
        let price_range = data.high - data.low;
        if price_range > data.low * Decimal::new(50, 2) {
            // 50% of low price
            warnings.push("Unusually large price range detected".to_string());
        }

        if data.volume == 0 {
            warnings.push("Zero volume detected".to_string());
        }

        // Return validation result
        if !errors.is_empty() {
            ValidationResult::Invalid { reasons: errors }
        } else if !warnings.is_empty() {
            ValidationResult::Warning { reasons: warnings }
        } else {
            ValidationResult::Valid
        }
    }

    /// Validate order book data
    pub fn validate_order_book(&self, order_book: &OrderBook) -> ValidationResult {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        // Check if bids are sorted in descending order
        for i in 1..order_book.bids.len() {
            if order_book.bids[i].price > order_book.bids[i - 1].price {
                errors.push("Bid prices must be sorted in descending order".to_string());
                break;
            }
        }

        // Check if asks are sorted in ascending order
        for i in 1..order_book.asks.len() {
            if order_book.asks[i].price < order_book.asks[i - 1].price {
                errors.push("Ask prices must be sorted in ascending order".to_string());
                break;
            }
        }

        // Check for crossed book (bid >= ask)
        if let (Some(best_bid), Some(best_ask)) = (order_book.best_bid(), order_book.best_ask()) {
            if best_bid >= best_ask {
                errors.push("Order book is crossed (bid >= ask)".to_string());
            }
        }

        // Check for negative sizes
        for bid in &order_book.bids {
            if bid.size <= 0 {
                errors.push("Bid sizes must be positive".to_string());
                break;
            }
        }

        for ask in &order_book.asks {
            if ask.size <= 0 {
                errors.push("Ask sizes must be positive".to_string());
                break;
            }
        }

        // Check for empty order book
        if order_book.bids.is_empty() && order_book.asks.is_empty() {
            warnings.push("Order book is empty".to_string());
        }

        // Check for wide spreads
        if let Some(spread_percent) = order_book.spread().and_then(|spread| {
            order_book.best_bid().map(|bid| {
                let spread_decimal = spread / bid * Decimal::from(100);
                spread_decimal.to_f64().unwrap_or(0.0)
            })
        }) {
            if spread_percent > self.max_spread_percent {
                warnings.push(format!("Wide spread detected: {:.2}%", spread_percent));
            }
        }

        // Return validation result
        if !errors.is_empty() {
            ValidationResult::Invalid { reasons: errors }
        } else if !warnings.is_empty() {
            ValidationResult::Warning { reasons: warnings }
        } else {
            ValidationResult::Valid
        }
    }

    // Private validation methods
    fn validate_basic_fields(
        &self,
        data: &MarketData,
        errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        if data.symbol.is_empty() {
            errors.push("Symbol cannot be empty".to_string());
        } else if !self.is_valid_symbol(&data.symbol) {
            warnings.push(format!("Unknown symbol: {}", data.symbol));
        }
    }

    fn validate_price_data(
        &self,
        data: &MarketData,
        errors: &mut Vec<String>,
        _warnings: &mut Vec<String>,
    ) {
        if data.price <= Decimal::ZERO {
            errors.push("Price must be positive".to_string());
        } else if data.price < self.min_price {
            errors.push(format!(
                "Price {} is below minimum threshold {}",
                data.price, self.min_price
            ));
        } else if data.price > self.max_price {
            errors.push(format!(
                "Price {} exceeds maximum threshold {}",
                data.price, self.max_price
            ));
        }
    }

    fn validate_volume_data(
        &self,
        data: &MarketData,
        errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        if data.volume < 0 {
            errors.push("Volume cannot be negative".to_string());
        } else if data.volume > self.max_volume {
            errors.push(format!(
                "Volume {} exceeds maximum threshold {}",
                data.volume, self.max_volume
            ));
        } else if data.volume == 0 {
            warnings.push("Zero volume detected".to_string());
        }
    }

    fn validate_bid_ask_data(
        &self,
        data: &MarketData,
        errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        if let (Some(bid), Some(ask)) = (data.bid_price, data.ask_price) {
            if bid >= ask {
                errors.push("Bid price must be less than ask price".to_string());
            } else {
                let spread = ask - bid;
                let spread_percentage = (spread / data.price) * Decimal::from(100);

                if spread_percentage
                    > Decimal::try_from(self.max_spread_percent).unwrap_or(Decimal::from(10))
                {
                    warnings.push(format!(
                        "Large bid-ask spread: {:.2}%",
                        spread_percentage.to_f64().unwrap_or(0.0)
                    ));
                }
            }
        }

        // Check bid/ask sizes
        if let (Some(bid_size), Some(ask_size)) = (data.bid_size, data.ask_size) {
            if bid_size < 0 || ask_size < 0 {
                errors.push("Bid/ask sizes cannot be negative".to_string());
            }
        }
    }

    fn validate_timestamp(
        &self,
        data: &MarketData,
        errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        let now = Utc::now();
        let max_future_time = now + Duration::minutes(5);

        if data.timestamp > max_future_time {
            errors.push("Timestamp is too far in the future".to_string());
        }

        // Check if data is stale (older than 1 hour for real-time data)
        let min_time = now - Duration::hours(1);
        if data.timestamp < min_time {
            warnings.push("Data appears to be stale".to_string());
        }
    }

    fn validate_symbol_and_exchange(
        &self,
        data: &MarketData,
        _errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        if let Some(exchange) = &data.exchange {
            if !self.exchange_configs.contains_key(exchange) {
                warnings.push(format!("Unknown exchange: {}", exchange));
            }
        }
    }

    fn validate_market_hours(
        &self,
        data: &MarketData,
        _errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        if let Some(exchange) = &data.exchange {
            if let Some(config) = self.exchange_configs.get(exchange) {
                let market_time = data.timestamp.time();
                if market_time < config.trading_hours.market_open
                    || market_time > config.trading_hours.market_close
                {
                    warnings.push("Data received outside market hours".to_string());
                }
            }
        }
    }

    fn validate_price_changes(
        &self,
        data: &MarketData,
        _errors: &mut Vec<String>,
        warnings: &mut Vec<String>,
    ) {
        if let Some(change_percent) = data.price_change_percent() {
            if change_percent.abs() > self.max_price_change_percent {
                warnings.push(format!(
                    "Large price change detected: {:.2}%",
                    change_percent
                ));
            }
        }
    }

    /// Check if symbol is in the valid symbols list or follows valid format
    fn is_valid_symbol(&self, symbol: &str) -> bool {
        self.valid_symbols.contains(symbol) || self.is_valid_symbol_format(symbol)
    }

    /// Check if symbol follows valid format patterns
    fn is_valid_symbol_format(&self, symbol: &str) -> bool {
        // HK stock format: 4 digits + .HK
        if symbol.len() == 7 && symbol.ends_with(".HK") {
            let number_part = &symbol[0..4];
            return number_part.chars().all(|c| c.is_ascii_digit());
        }

        // US stock format: 1-5 uppercase letters
        if symbol.len() >= 1 && symbol.len() <= 5 {
            return symbol.chars().all(|c| c.is_ascii_uppercase());
        }

        false
    }

    /// Add a new valid symbol
    pub fn add_valid_symbol(&mut self, symbol: String) {
        self.valid_symbols.insert(symbol);
    }

    /// Remove a symbol from valid symbols
    pub fn remove_valid_symbol(&mut self, symbol: &str) {
        self.valid_symbols.remove(symbol);
    }

    /// Update price thresholds
    pub fn update_price_thresholds(&mut self, min_price: Decimal, max_price: Decimal) {
        self.min_price = min_price;
        self.max_price = max_price;
    }

    /// Update volume threshold
    pub fn update_volume_threshold(&mut self, max_volume: i64) {
        self.max_volume = max_volume;
    }

    /// Update spread threshold
    pub fn update_spread_threshold(&mut self, max_spread_percent: f64) {
        self.max_spread_percent = max_spread_percent;
    }

    /// Add exchange configuration
    pub fn add_exchange_config(&mut self, exchange: String, config: ExchangeConfig) {
        self.exchange_configs.insert(exchange, config);
    }
}

impl Default for DataValidator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::OrderBookLevel;
    use rust_decimal::Decimal;
    use std::str::FromStr;

    #[test]
    fn test_valid_market_data() {
        let validator = DataValidator::new();
        let data = MarketData::new(
            "AAPL".to_string(),
            Decimal::from_str("150.50").unwrap(),
            1000,
        );

        let result = validator.validate(&data);
        assert!(result.is_valid());
    }

    #[test]
    fn test_enhanced_market_data() {
        let validator = DataValidator::new();
        let data = MarketData::new(
            "AAPL".to_string(),
            Decimal::from_str("150.50").unwrap(),
            1000,
        )
        .with_bid_ask(
            Decimal::from_str("150.49").unwrap(),
            Decimal::from_str("150.51").unwrap(),
            500,
            300,
        )
        .with_ohlc(
            Decimal::from_str("149.00").unwrap(),
            Decimal::from_str("151.00").unwrap(),
            Decimal::from_str("148.50").unwrap(),
            Decimal::from_str("149.50").unwrap(),
        )
        .with_source("NASDAQ".to_string(), "NASDAQ".to_string());

        let result = validator.validate(&data);
        assert!(result.is_valid());

        // Test price change calculation
        assert!(data.price_change().is_some());
        assert!(data.price_change_percent().is_some());
        assert!(data.bid_ask_spread().is_some());
    }

    #[test]
    fn test_invalid_price() {
        let validator = DataValidator::new();
        let data = MarketData::new("AAPL".to_string(), Decimal::ZERO, 1000);

        let result = validator.validate(&data);
        assert!(result.is_invalid());
    }

    #[test]
    fn test_invalid_bid_ask_spread() {
        let validator = DataValidator::new();
        let data = MarketData::new(
            "AAPL".to_string(),
            Decimal::from_str("150.50").unwrap(),
            1000,
        )
        .with_bid_ask(
            Decimal::from_str("151.00").unwrap(), // Bid higher than ask
            Decimal::from_str("150.50").unwrap(),
            100,
            100,
        );

        let result = validator.validate(&data);
        assert!(result.is_invalid());
    }

    #[test]
    fn test_hk_symbol_format() {
        let validator = DataValidator::new();

        // Valid HK symbol
        let data = MarketData::new(
            "0700.HK".to_string(),
            Decimal::from_str("400.00").unwrap(),
            1000,
        );
        let result = validator.validate(&data);
        assert!(result.is_valid());

        // Invalid HK symbol format
        let data = MarketData::new(
            "70.HK".to_string(),
            Decimal::from_str("400.00").unwrap(),
            1000,
        );
        let result = validator.validate(&data);
        assert!(result.has_warnings()); // Should have warning for unknown symbol
    }

    #[test]
    fn test_candlestick_validation() {
        let validator = DataValidator::new();

        // Valid candlestick
        let candle = CandlestickData::new(
            "AAPL".to_string(),
            Decimal::from_str("150.00").unwrap(),
            Decimal::from_str("152.00").unwrap(),
            Decimal::from_str("149.00").unwrap(),
            Decimal::from_str("151.00").unwrap(),
            10000,
        );

        let result = validator.validate_candlestick(&candle);
        assert!(result.is_valid());

        // Test candlestick methods
        assert!(candle.is_bullish());
        assert!(!candle.is_bearish());
        assert!(!candle.is_doji(0.1));
        assert_eq!(candle.price_range(), Decimal::from_str("3.00").unwrap());
    }

    #[test]
    fn test_invalid_candlestick() {
        let validator = DataValidator::new();

        // Invalid candlestick (high < low)
        let candle = CandlestickData::new(
            "AAPL".to_string(),
            Decimal::from_str("150.00").unwrap(),
            Decimal::from_str("149.00").unwrap(), // High < Low
            Decimal::from_str("152.00").unwrap(),
            Decimal::from_str("151.00").unwrap(),
            10000,
        );

        let result = validator.validate_candlestick(&candle);
        assert!(result.is_invalid());
    }

    #[test]
    fn test_order_book_validation() {
        let validator = DataValidator::new();

        let mut order_book = OrderBook::new("AAPL".to_string());

        // Add valid bids (descending order)
        order_book.bids.push(OrderBookLevel {
            price: Decimal::from_str("150.00").unwrap(),
            size: 1000,
            orders_count: Some(5),
        });
        order_book.bids.push(OrderBookLevel {
            price: Decimal::from_str("149.99").unwrap(),
            size: 500,
            orders_count: Some(3),
        });

        // Add valid asks (ascending order)
        order_book.asks.push(OrderBookLevel {
            price: Decimal::from_str("150.01").unwrap(),
            size: 800,
            orders_count: Some(4),
        });
        order_book.asks.push(OrderBookLevel {
            price: Decimal::from_str("150.02").unwrap(),
            size: 600,
            orders_count: Some(2),
        });

        let result = validator.validate_order_book(&order_book);
        assert!(result.is_valid());

        // Test order book methods
        assert_eq!(
            order_book.best_bid(),
            Some(Decimal::from_str("150.00").unwrap())
        );
        assert_eq!(
            order_book.best_ask(),
            Some(Decimal::from_str("150.01").unwrap())
        );
        assert_eq!(
            order_book.spread(),
            Some(Decimal::from_str("0.01").unwrap())
        );
        assert_eq!(order_book.total_bid_volume(), 1500);
        assert_eq!(order_book.total_ask_volume(), 1400);
    }

    #[test]
    fn test_crossed_order_book() {
        let validator = DataValidator::new();

        let mut order_book = OrderBook::new("AAPL".to_string());

        // Add crossed book (bid >= ask)
        order_book.bids.push(OrderBookLevel {
            price: Decimal::from_str("150.01").unwrap(), // Bid higher than ask
            size: 1000,
            orders_count: Some(5),
        });

        order_book.asks.push(OrderBookLevel {
            price: Decimal::from_str("150.00").unwrap(),
            size: 800,
            orders_count: Some(4),
        });

        let result = validator.validate_order_book(&order_book);
        assert!(result.is_invalid());
    }

    #[test]
    fn test_price_change_calculations() {
        let data = MarketData::new(
            "AAPL".to_string(),
            Decimal::from_str("150.00").unwrap(),
            1000,
        )
        .with_ohlc(
            Decimal::from_str("149.00").unwrap(),
            Decimal::from_str("151.00").unwrap(),
            Decimal::from_str("148.50").unwrap(),
            Decimal::from_str("145.00").unwrap(), // Previous close
        );

        let price_change = data.price_change().unwrap();
        let price_change_percent = data.price_change_percent().unwrap();

        assert_eq!(price_change, Decimal::from_str("5.00").unwrap());
        assert!((price_change_percent - 3.4482758620689655).abs() < 0.0001); // ~3.45%
    }

    #[test]
    fn test_validator_configuration() {
        let mut validator = DataValidator::new();

        // Test adding symbols
        validator.add_valid_symbol("TEST".to_string());
        assert!(validator.is_valid_symbol("TEST"));

        // Test removing symbols
        validator.remove_valid_symbol("TEST");
        assert!(!validator.valid_symbols.contains("TEST"));

        // Test updating thresholds
        validator.update_price_thresholds(
            Decimal::from_str("0.01").unwrap(),
            Decimal::from_str("5000.00").unwrap(),
        );
        validator.update_volume_threshold(500_000_000);
        validator.update_spread_threshold(5.0);

        assert_eq!(validator.min_price, Decimal::from_str("0.01").unwrap());
        assert_eq!(validator.max_price, Decimal::from_str("5000.00").unwrap());
        assert_eq!(validator.max_volume, 500_000_000);
        assert_eq!(validator.max_spread_percent, 5.0);
    }
}
