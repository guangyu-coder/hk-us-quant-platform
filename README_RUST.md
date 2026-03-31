# HK-US Quantitative Trading Platform (Rust Implementation)

A high-performance quantitative trading platform for Hong Kong and US markets, built with Rust for maximum performance and safety.

## Features

- **Event-driven Architecture**: Asynchronous message passing with Redis Streams
- **High Performance**: Built with Rust and Tokio for maximum throughput
- **Memory Safety**: Leverages Rust's ownership system to prevent memory leaks
- **Time-series Optimization**: Uses TimescaleDB for efficient market data storage
- **Microservices Design**: Modular services for data, strategy, execution, portfolio, and risk management
- **Property-based Testing**: Comprehensive testing with PropTest library

## Architecture

### Core Services

1. **Data Service**: Market data collection, validation, and storage
2. **Strategy Service**: Trading strategy management and signal generation
3. **Execution Service**: Order management and broker integration
4. **Portfolio Service**: Position tracking and P&L calculation
5. **Risk Service**: Pre-trade risk checks and portfolio risk monitoring

### Technology Stack

- **Language**: Rust 2021 Edition
- **Web Framework**: Axum (async, high-performance)
- **Database**: PostgreSQL + TimescaleDB
- **Cache/Messaging**: Redis + Redis Streams
- **Serialization**: Serde
- **Async Runtime**: Tokio
- **Testing**: Built-in tests + PropTest for property-based testing

## Quick Start

### Prerequisites

- Rust 1.75+ 
- Docker and Docker Compose
- PostgreSQL with TimescaleDB extension
- Redis

### Containerized Setup

1. **Clone and setup the project**:
   ```bash
   git clone <repository>
   cd hk-us-quant-platform
   ```

2. **Start the full stack**:
   ```bash
   ./scripts/deploy.sh up --build
   ```

3. **Check service status**:
   ```bash
   ./scripts/deploy.sh status
   ```

4. **Stop the stack**:
   ```bash
   ./scripts/deploy.sh down
   ```

5. **Run tests**:
   ```bash
   # Unit tests
   cargo test
   
   # Property-based tests
   cargo test --features proptest
   ```

### Production Setup

Use the same container entrypoint:
```bash
./scripts/deploy.sh up --build
```

## Configuration

The application uses environment variables for configuration. Copy `.env.example` to `.env` and adjust values:

### Key Configuration Options

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string  
- `LOG_LEVEL`: Logging level (trace, debug, info, warn, error)
- `PAPER_TRADING`: Enable/disable paper trading mode
- `MAX_ORDER_SIZE`: Maximum allowed order size
- `RISK_CHECK_ENABLED`: Enable pre-trade risk checks

## API Endpoints

### Health Check
```
GET /health
```

### Market Data
```
GET /api/v1/market-data/{symbol}
```

### Strategies
```
GET /api/v1/strategies
```

### Orders
```
POST /api/v1/orders
```

### Portfolio
```
GET /api/v1/portfolio
```

## Database Schema

The platform uses PostgreSQL with TimescaleDB for time-series optimization:

- **market_data**: Time-series market data (hypertable)
- **strategies**: Trading strategy configurations
- **orders**: Order management and tracking
- **portfolios**: Portfolio information
- **positions**: Position tracking
- **trades**: Executed trade history
- **risk_alerts**: Risk management alerts

## Event System

The platform uses Redis Streams for event-driven communication:

### Event Types

- `market_data_received`: New market data available
- `signal_generated`: Trading signal created
- `order_created`: New order submitted
- `order_filled`: Order execution completed
- `position_updated`: Portfolio position changed
- `risk_alert_triggered`: Risk threshold exceeded

## Testing Strategy

### Unit Tests
- Service-level functionality testing
- Database integration testing
- API endpoint testing

### Property-based Tests
- Data validation properties
- Strategy signal generation properties
- Risk check consistency properties
- Portfolio state consistency properties

### Running Tests
```bash
# All tests
cargo test

# Specific test module
cargo test data::tests

# Property tests with more iterations
PROPTEST_CASES=1000 cargo test
```

## Performance Considerations

### Optimizations
- **Zero-cost abstractions**: Rust's compile-time optimizations
- **Async I/O**: Non-blocking operations with Tokio
- **Connection pooling**: Efficient database and Redis connections
- **Time-series optimization**: TimescaleDB for market data queries
- **Memory efficiency**: Rust's ownership system prevents leaks

### Monitoring
- Structured JSON logging
- Health check endpoints
- Performance metrics collection
- Error tracking and alerting

## Development Guidelines

### Code Organization
```
src/
├── main.rs              # Application entry point
├── config.rs            # Configuration management
├── error.rs             # Error handling
├── events.rs            # Event system
├── types.rs             # Core data types
├── data/                # Data service
├── strategy/            # Strategy service  
├── execution/           # Execution service
├── portfolio/           # Portfolio service
└── risk/                # Risk service
```

### Error Handling
- Use `Result<T, AppError>` for all fallible operations
- Implement proper error categorization
- Log errors with appropriate levels
- Provide meaningful error messages

### Testing
- Write unit tests for all public functions
- Use property-based tests for data validation
- Test error conditions and edge cases
- Maintain high test coverage

## Deployment

### Docker Deployment
```bash
# Build and run
./scripts/deploy.sh up --build

# Stop services
./scripts/deploy.sh down

# Remove services and volumes
./scripts/deploy.sh destroy
```

### Environment Variables
Ensure all required environment variables are set in production:
- Database credentials
- Redis configuration
- Broker API keys (when implemented)
- Monitoring endpoints

## Contributing

1. Follow Rust coding conventions
2. Write comprehensive tests
3. Update documentation
4. Use meaningful commit messages
5. Ensure all tests pass before submitting

## License

[Add your license information here]

## Support

For questions and support, please [add contact information or issue tracker].
