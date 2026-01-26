use chrono::{DateTime, Duration, Utc};
use hk_us_quant_platform::data::DataValidator;
use hk_us_quant_platform::types::*;
use proptest::prelude::*;
use rust_decimal::Decimal;
use std::str::FromStr;

/// Property-based tests for data processing round-trip consistency
/// 属性 1: 数据处理往返一致性
/// 验证需求: 1.2, 1.4

// Strategy for generating valid decimal prices
fn arb_price() -> impl Strategy<Value = Decimal> {
    (1u64..1000000u64, 0u32..4u32).prop_map(|(whole, scale)| Decimal::new(whole as i64, scale))
}

// Strategy for generating valid volumes
fn arb_volume() -> impl Strategy<Value = i64> {
    0i64..1_000_000_000i64
}

// Strategy for generating valid symbols
fn arb_symbol() -> impl Strategy<Value = String> {
    prop_oneof![
        // US stock symbols
        "[A-Z]{1,5}".prop_map(|s| s.to_string()),
        // HK stock symbols
        "[0-9]{4}\\.HK".prop_map(|s| s.to_string()),
    ]
}

// Strategy for generating valid timestamps (within last 24 hours)
fn arb_timestamp() -> impl Strategy<Value = DateTime<Utc>> {
    (0i64..86400i64).prop_map(|seconds| Utc::now() - Duration::seconds(seconds))
}

// Strategy for generating MarketData
fn arb_market_data() -> impl Strategy<Value = MarketData> {
    (arb_symbol(), arb_price(), arb_volume(), arb_timestamp()).prop_map(
        |(symbol, price, volume, timestamp)| {
            let mut data = MarketData::new(symbol, price, volume);
            data.timestamp = timestamp;
            data
        },
    )
}

proptest! {
    /// Test that MarketData serialization and deserialization is consistent
    #[test]
    fn test_market_data_serde_roundtrip(data in arb_market_data()) {
        // Serialize to JSON
        let json = serde_json::to_string(&data).expect("Failed to serialize MarketData");

        // Deserialize back
        let deserialized: MarketData = serde_json::from_str(&json).expect("Failed to deserialize MarketData");

        // Should be identical
        prop_assert_eq!(&data.symbol, &deserialized.symbol);
        prop_assert_eq!(data.price, deserialized.price);
        prop_assert_eq!(data.volume, deserialized.volume);
        prop_assert_eq!(data.timestamp.timestamp(), deserialized.timestamp.timestamp());
    }

    /// Test that DataValidator produces consistent results
    #[test]
    fn test_data_validator_consistency(data in arb_market_data()) {
        let validator = DataValidator::new();

        // Validation should be deterministic
        let result1 = validator.validate(&data);
        let result2 = validator.validate(&data);

        prop_assert_eq!(result1.is_valid(), result2.is_valid());
        prop_assert_eq!(result1.is_invalid(), result2.is_invalid());
        prop_assert_eq!(result1.has_warnings(), result2.has_warnings());

        // If data is valid, it should remain valid after cloning
        if result1.is_valid() {
            let cloned_data = data.clone();
            let cloned_result = validator.validate(&cloned_data);
            prop_assert!(cloned_result.is_valid());
        }
    }

    /// Test that Signal generation maintains consistency
    #[test]
    fn test_signal_consistency(
        strategy_id in "[a-zA-Z0-9_-]{1,20}",
        symbol in arb_symbol(),
        signal_type in prop_oneof![Just(SignalType::Buy), Just(SignalType::Sell), Just(SignalType::Hold)],
        strength in 0.0f64..1.0f64
    ) {
        let signal = Signal::new(strategy_id.clone(), symbol.clone(), signal_type, strength);

        // Basic properties
        prop_assert_eq!(&signal.strategy_id, &strategy_id);
        prop_assert_eq!(&signal.symbol, &symbol);
        prop_assert_eq!(signal.signal_type, signal_type);
        prop_assert!(signal.strength >= 0.0 && signal.strength <= 1.0);

        // Strength should be clamped
        let clamped_strength = strength.clamp(0.0, 1.0);
        prop_assert_eq!(signal.strength, clamped_strength);

        // Serialization roundtrip
        let json = serde_json::to_string(&signal).expect("Failed to serialize Signal");
        let deserialized: Signal = serde_json::from_str(&json).expect("Failed to deserialize Signal");

        prop_assert_eq!(&signal.strategy_id, &deserialized.strategy_id);
        prop_assert_eq!(&signal.symbol, &deserialized.symbol);
        prop_assert_eq!(signal.signal_type, deserialized.signal_type);
        prop_assert!((signal.strength - deserialized.strength).abs() < 1e-12);
    }

    /// Test that Order state transitions are consistent
    #[test]
    fn test_order_consistency(
        symbol in arb_symbol(),
        side in prop_oneof![Just(OrderSide::Buy), Just(OrderSide::Sell)],
        quantity in 1i64..1000000i64,
        order_type in prop_oneof![
            Just(OrderType::Market),
            Just(OrderType::Limit),
            Just(OrderType::Stop),
            Just(OrderType::StopLimit)
        ],
        price in arb_price()
    ) {
        let order = Order::new(symbol.clone(), side, quantity, order_type)
            .with_price(price);

        // Basic properties
        prop_assert_eq!(&order.symbol, &symbol);
        prop_assert_eq!(order.side, side);
        prop_assert_eq!(order.quantity, quantity);
        prop_assert_eq!(order.order_type, order_type);
        prop_assert_eq!(order.price, Some(price));
        prop_assert_eq!(order.status, OrderStatus::Pending);
        prop_assert_eq!(order.filled_quantity, 0);

        // Timestamps should be reasonable
        prop_assert!(order.created_at <= order.updated_at);

        // Serialization roundtrip
        let json = serde_json::to_string(&order).expect("Failed to serialize Order");
        let deserialized: Order = serde_json::from_str(&json).expect("Failed to deserialize Order");

        prop_assert_eq!(&order.symbol, &deserialized.symbol);
        prop_assert_eq!(order.side, deserialized.side);
        prop_assert_eq!(order.quantity, deserialized.quantity);
        prop_assert_eq!(order.order_type, deserialized.order_type);
        prop_assert_eq!(order.price, deserialized.price);
    }

    /// Test that Position calculations are mathematically consistent
    #[test]
    fn test_position_consistency(
        symbol in arb_symbol(),
        quantity in -1000000i64..1000000i64,
        average_cost in arb_price(),
        current_price in arb_price()
    ) {
        let mut position = Position::new(symbol.clone(), quantity, average_cost);
        position.update_market_value(current_price);

        // Basic properties
        prop_assert_eq!(&position.symbol, &symbol);
        prop_assert_eq!(position.quantity, quantity);
        prop_assert_eq!(position.average_cost, average_cost);

        // Market value calculation should be consistent
        let expected_market_value = current_price * Decimal::from(quantity.abs());
        prop_assert_eq!(position.market_value, expected_market_value);

        // Unrealized P&L calculation should be consistent
        let expected_unrealized_pnl = position.market_value - (average_cost * Decimal::from(quantity.abs()));
        prop_assert_eq!(position.unrealized_pnl, expected_unrealized_pnl);

        // Serialization roundtrip
        let json = serde_json::to_string(&position).expect("Failed to serialize Position");
        let deserialized: Position = serde_json::from_str(&json).expect("Failed to deserialize Position");

        prop_assert_eq!(&position.symbol, &deserialized.symbol);
        prop_assert_eq!(position.quantity, deserialized.quantity);
        prop_assert_eq!(position.average_cost, deserialized.average_cost);
        prop_assert_eq!(position.market_value, deserialized.market_value);
    }

    /// Test that Portfolio calculations maintain consistency
    #[test]
    fn test_portfolio_consistency(
        id in "[a-zA-Z0-9_-]{1,20}",
        name in "[a-zA-Z0-9 _-]{1,50}",
        initial_cash in arb_price()
    ) {
        let mut portfolio = Portfolio::new(id.clone(), name.clone(), initial_cash);

        // Basic properties
        prop_assert_eq!(&portfolio.id, &id);
        prop_assert_eq!(&portfolio.name, &name);
        prop_assert_eq!(portfolio.cash_balance, initial_cash);
        prop_assert_eq!(portfolio.total_value, initial_cash);
        prop_assert!(portfolio.positions.is_empty());

        // Add some positions and recalculate
        let position1 = Position::new("AAPL".to_string(), 100, Decimal::from_str("150.00").unwrap());
        let position2 = Position::new("GOOGL".to_string(), 50, Decimal::from_str("2500.00").unwrap());

        portfolio.positions.insert("AAPL".to_string(), position1);
        portfolio.positions.insert("GOOGL".to_string(), position2);

        portfolio.calculate_total_value();

        // Total value should include cash and positions
        let positions_value: Decimal = portfolio.positions.values().map(|p| p.market_value).sum();
        let expected_total = portfolio.cash_balance + positions_value;
        prop_assert_eq!(portfolio.total_value, expected_total);

        // Unrealized P&L should be sum of position P&Ls
        let expected_unrealized: Decimal = portfolio.positions.values().map(|p| p.unrealized_pnl).sum();
        prop_assert_eq!(portfolio.unrealized_pnl, expected_unrealized);

        // Serialization roundtrip
        let json = serde_json::to_string(&portfolio).expect("Failed to serialize Portfolio");
        let deserialized: Portfolio = serde_json::from_str(&json).expect("Failed to deserialize Portfolio");

        prop_assert_eq!(&portfolio.id, &deserialized.id);
        prop_assert_eq!(&portfolio.name, &deserialized.name);
        prop_assert_eq!(portfolio.cash_balance, deserialized.cash_balance);
        prop_assert_eq!(portfolio.positions.len(), deserialized.positions.len());
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use hk_us_quant_platform::data::DataValidator;

    /// Integration test for data validation with property-based testing
    #[test]
    fn test_data_validation_integration() {
        let validator = DataValidator::new();

        // Test with known valid data
        let valid_data = MarketData::new(
            "AAPL".to_string(),
            Decimal::from_str("150.50").unwrap(),
            1000,
        );

        let result = validator.validate(&valid_data);
        assert!(result.is_valid());

        // Test with known invalid data
        let invalid_data = MarketData::new(
            "".to_string(), // Empty symbol
            Decimal::ZERO,  // Zero price
            -100,           // Negative volume
        );

        let result = validator.validate(&invalid_data);
        assert!(result.is_invalid());
    }
}
