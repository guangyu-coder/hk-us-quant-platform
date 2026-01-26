use hk_us_quant_platform::config::AppConfig;
use std::env;

#[tokio::test]
async fn test_config_loading() {
    // Set up test environment variables
    env::set_var(
        "DATABASE_URL",
        "postgresql://test:test@localhost:5432/test_db",
    );
    env::set_var("REDIS_URL", "redis://localhost:6379");
    env::set_var("SERVER_PORT", "8080");
    env::set_var("LOG_LEVEL", "info");
    env::set_var("PAPER_TRADING", "true");

    // Test configuration loading
    let config = AppConfig::load();
    assert!(config.is_ok(), "Configuration should load successfully");

    let config = config.unwrap();
    assert_eq!(config.server.port, 8080);
    assert_eq!(config.logging.level, "info");
    assert!(config.trading.paper_trading);
    assert!(config.trading.risk_check_enabled); // Default value
}

#[test]
fn test_data_validator() {
    use hk_us_quant_platform::data::DataValidator;
    use hk_us_quant_platform::types::MarketData;
    use rust_decimal::Decimal;
    use std::str::FromStr;

    let validator = DataValidator::new();

    // Test valid data
    let valid_data = MarketData::new(
        "AAPL".to_string(),
        Decimal::from_str("150.50").unwrap(),
        1000,
    );

    let result = validator.validate(&valid_data);
    assert!(
        result.is_valid(),
        "Valid market data should pass validation"
    );

    // Test invalid data (zero price)
    let invalid_data = MarketData::new("AAPL".to_string(), Decimal::ZERO, 1000);

    let result = validator.validate(&invalid_data);
    assert!(
        result.is_invalid(),
        "Invalid market data should fail validation"
    );
}

#[test]
fn test_market_data_creation() {
    use hk_us_quant_platform::types::MarketData;
    use rust_decimal::Decimal;
    use std::str::FromStr;

    let data = MarketData::new(
        "TSLA".to_string(),
        Decimal::from_str("250.75").unwrap(),
        5000,
    )
    .with_bid_ask(
        Decimal::from_str("250.70").unwrap(),
        Decimal::from_str("250.80").unwrap(),
        1000,
        800,
    );

    assert_eq!(data.symbol, "TSLA");
    assert_eq!(data.price, Decimal::from_str("250.75").unwrap());
    assert_eq!(data.volume, 5000);
    assert_eq!(data.bid_price, Some(Decimal::from_str("250.70").unwrap()));
    assert_eq!(data.ask_price, Some(Decimal::from_str("250.80").unwrap()));
    assert_eq!(data.bid_size, Some(1000));
    assert_eq!(data.ask_size, Some(800));
}

#[test]
fn test_signal_creation() {
    use hk_us_quant_platform::types::{Signal, SignalType};

    let signal = Signal::new(
        "test_strategy".to_string(),
        "GOOGL".to_string(),
        SignalType::Buy,
        0.8,
    );

    assert_eq!(signal.strategy_id, "test_strategy");
    assert_eq!(signal.symbol, "GOOGL");
    assert_eq!(signal.signal_type, SignalType::Buy);
    assert_eq!(signal.strength, 0.8);
    assert!(!signal.id.to_string().is_empty());
}

#[test]
fn test_order_creation() {
    use hk_us_quant_platform::types::{Order, OrderSide, OrderStatus, OrderType};
    use rust_decimal::Decimal;
    use std::str::FromStr;

    let order = Order::new("MSFT".to_string(), OrderSide::Buy, 100, OrderType::Limit)
        .with_price(Decimal::from_str("300.00").unwrap())
        .with_strategy("momentum_strategy".to_string());

    assert_eq!(order.symbol, "MSFT");
    assert_eq!(order.side, OrderSide::Buy);
    assert_eq!(order.quantity, 100);
    assert_eq!(order.order_type, OrderType::Limit);
    assert_eq!(order.status, OrderStatus::Pending);
    assert_eq!(order.price, Some(Decimal::from_str("300.00").unwrap()));
    assert_eq!(order.strategy_id, Some("momentum_strategy".to_string()));
    assert_eq!(order.filled_quantity, 0);
}

#[test]
fn test_position_creation_and_update() {
    use hk_us_quant_platform::types::Position;
    use rust_decimal::Decimal;
    use std::str::FromStr;

    let mut position = Position::new(
        "AMZN".to_string(),
        50,
        Decimal::from_str("3200.00").unwrap(),
    );

    assert_eq!(position.symbol, "AMZN");
    assert_eq!(position.quantity, 50);
    assert_eq!(position.average_cost, Decimal::from_str("3200.00").unwrap());
    assert_eq!(position.market_value, Decimal::ZERO);
    assert_eq!(position.unrealized_pnl, Decimal::ZERO);

    // Update market value
    position.update_market_value(Decimal::from_str("3300.00").unwrap());

    let expected_market_value = Decimal::from_str("3300.00").unwrap() * Decimal::from(50);
    let expected_unrealized_pnl =
        expected_market_value - (Decimal::from_str("3200.00").unwrap() * Decimal::from(50));

    assert_eq!(position.market_value, expected_market_value);
    assert_eq!(position.unrealized_pnl, expected_unrealized_pnl);
}

#[test]
fn test_portfolio_creation() {
    use hk_us_quant_platform::types::Portfolio;
    use rust_decimal::Decimal;
    use std::str::FromStr;

    let mut portfolio = Portfolio::new(
        "test_portfolio".to_string(),
        "Test Portfolio".to_string(),
        Decimal::from_str("100000.00").unwrap(),
    );

    assert_eq!(portfolio.id, "test_portfolio");
    assert_eq!(portfolio.name, "Test Portfolio");
    assert_eq!(
        portfolio.cash_balance,
        Decimal::from_str("100000.00").unwrap()
    );
    assert_eq!(
        portfolio.total_value,
        Decimal::from_str("100000.00").unwrap()
    );
    assert!(portfolio.positions.is_empty());

    // Test portfolio value calculation
    portfolio.calculate_total_value();
    assert_eq!(
        portfolio.total_value,
        Decimal::from_str("100000.00").unwrap()
    );
}

#[test]
fn test_strategy_config_creation() {
    use hk_us_quant_platform::types::StrategyConfig;

    let config = StrategyConfig::new(
        "sma_strategy".to_string(),
        "Simple Moving Average Strategy".to_string(),
    );

    assert_eq!(config.id, "sma_strategy");
    assert_eq!(config.name, "Simple Moving Average Strategy");
    assert!(config.is_active);
    assert!(config.parameters.is_empty());
    assert!(config.description.is_none());
}
