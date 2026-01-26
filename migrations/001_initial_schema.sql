-- Initial database schema for HK-US Quantitative Trading Platform

-- Enable TimescaleDB extension for time-series data
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Market data table (time-series optimized)
CREATE TABLE market_data (
    symbol VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    price DECIMAL(18,6) NOT NULL,
    volume BIGINT NOT NULL,
    bid_price DECIMAL(18,6),
    ask_price DECIMAL(18,6),
    bid_size BIGINT,
    ask_size BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, timestamp)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('market_data', 'timestamp', if_not_exists => TRUE);

-- Enable compression
ALTER TABLE market_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol'
);

-- Create indexes for efficient querying
CREATE INDEX idx_market_data_symbol_timestamp ON market_data (symbol, timestamp DESC);
CREATE INDEX idx_market_data_timestamp ON market_data (timestamp DESC);

-- Strategies table
CREATE TABLE strategies (
    strategy_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_strategies_active ON strategies (is_active);
CREATE INDEX idx_strategies_name ON strategies (name);

-- Orders table
CREATE TABLE orders (
    order_id UUID PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    price DECIMAL(18,6),
    order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED')),
    strategy_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    filled_quantity BIGINT DEFAULT 0,
    average_fill_price DECIMAL(18,6),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

CREATE INDEX idx_orders_symbol ON orders (symbol);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_strategy ON orders (strategy_id);
CREATE INDEX idx_orders_created_at ON orders (created_at DESC);

-- Portfolios table
CREATE TABLE portfolios (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    cash_balance DECIMAL(18,6) NOT NULL DEFAULT 0,
    total_value DECIMAL(18,6) NOT NULL DEFAULT 0,
    unrealized_pnl DECIMAL(18,6) NOT NULL DEFAULT 0,
    realized_pnl DECIMAL(18,6) NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Positions table
CREATE TABLE positions (
    id BIGSERIAL PRIMARY KEY,
    portfolio_id VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    quantity BIGINT NOT NULL,
    average_cost DECIMAL(18,6) NOT NULL,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
    UNIQUE(portfolio_id, symbol)
);

CREATE INDEX idx_positions_portfolio ON positions (portfolio_id);
CREATE INDEX idx_positions_symbol ON positions (symbol);

-- Risk alerts table
CREATE TABLE risk_alerts (
    id BIGSERIAL PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_alerts_type ON risk_alerts (alert_type);
CREATE INDEX idx_risk_alerts_severity ON risk_alerts (severity);
CREATE INDEX idx_risk_alerts_created_at ON risk_alerts (created_at DESC);

-- Trades table (for tracking executed trades)
CREATE TABLE trades (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    quantity BIGINT NOT NULL,
    price DECIMAL(18,6) NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW(),
    portfolio_id VARCHAR(50),
    strategy_id VARCHAR(50),
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

CREATE INDEX idx_trades_order_id ON trades (order_id);
CREATE INDEX idx_trades_symbol ON trades (symbol);
CREATE INDEX idx_trades_executed_at ON trades (executed_at DESC);
CREATE INDEX idx_trades_portfolio ON trades (portfolio_id);

-- Performance metrics table
CREATE TABLE performance_metrics (
    id BIGSERIAL PRIMARY KEY,
    portfolio_id VARCHAR(50) NOT NULL,
    strategy_id VARCHAR(50),
    date DATE NOT NULL,
    total_pnl DECIMAL(18,6) NOT NULL DEFAULT 0,
    realized_pnl DECIMAL(18,6) NOT NULL DEFAULT 0,
    unrealized_pnl DECIMAL(18,6) NOT NULL DEFAULT 0,
    total_return DECIMAL(10,6),
    sharpe_ratio DECIMAL(10,6),
    max_drawdown DECIMAL(10,6),
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id),
    UNIQUE(portfolio_id, strategy_id, date)
);

CREATE INDEX idx_performance_portfolio_date ON performance_metrics (portfolio_id, date DESC);
CREATE INDEX idx_performance_strategy_date ON performance_metrics (strategy_id, date DESC);

-- System configuration table
CREATE TABLE system_config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default configuration
INSERT INTO system_config (key, value, description) VALUES
('max_order_size', '10000', 'Maximum order size allowed'),
('max_leverage', '3.0', 'Maximum portfolio leverage'),
('risk_check_enabled', 'true', 'Enable pre-trade risk checks'),
('paper_trading', 'true', 'Enable paper trading mode'),
('market_hours_check', 'true', 'Check market hours before order submission');

-- Create default portfolio
INSERT INTO portfolios (id, name, cash_balance, total_value) VALUES
('default', 'Default Portfolio', 1000000.00, 1000000.00);

-- Data retention policies (TimescaleDB)
-- Keep raw market data for 1 year, then compress
SELECT add_retention_policy('market_data', INTERVAL '1 year');

-- Compress market data older than 7 days
SELECT add_compression_policy('market_data', INTERVAL '7 days');

-- Create continuous aggregates for performance analysis
-- CREATE MATERIALIZED VIEW daily_market_summary
-- WITH (timescaledb.continuous) AS
-- SELECT 
--     symbol,
--     time_bucket('1 day', timestamp) AS day,
--     first(price, timestamp) AS open_price,
--     max(price) AS high_price,
--     min(price) AS low_price,
--     last(price, timestamp) AS close_price,
--     sum(volume) AS total_volume,
--     count(*) AS tick_count
-- FROM market_data
-- GROUP BY symbol, day;

-- Refresh policy for continuous aggregate
-- SELECT add_continuous_aggregate_policy('daily_market_summary',
--     start_offset => INTERVAL '3 days',
--     end_offset => INTERVAL '1 hour',
--     schedule_interval => INTERVAL '1 hour');

-- Functions for common operations
CREATE OR REPLACE FUNCTION update_portfolio_value(p_portfolio_id VARCHAR(50))
RETURNS VOID AS $$
BEGIN
    UPDATE portfolios 
    SET 
        total_value = cash_balance + COALESCE((
            SELECT SUM(quantity * average_cost) 
            FROM positions 
            WHERE portfolio_id = p_portfolio_id
        ), 0),
        last_updated = NOW()
    WHERE id = p_portfolio_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update portfolio value when positions change
CREATE OR REPLACE FUNCTION trigger_update_portfolio_value()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_portfolio_value(COALESCE(NEW.portfolio_id, OLD.portfolio_id));
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER positions_update_portfolio
    AFTER INSERT OR UPDATE OR DELETE ON positions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_portfolio_value();

-- Views for common queries
CREATE VIEW active_strategies AS
SELECT * FROM strategies WHERE is_active = TRUE;

CREATE VIEW open_orders AS
SELECT * FROM orders WHERE status IN ('PENDING', 'SUBMITTED', 'PARTIALLY_FILLED');

CREATE VIEW portfolio_summary AS
SELECT 
    p.id,
    p.name,
    p.cash_balance,
    p.total_value,
    p.unrealized_pnl,
    p.realized_pnl,
    COUNT(pos.symbol) as position_count,
    p.last_updated
FROM portfolios p
LEFT JOIN positions pos ON p.id = pos.portfolio_id
GROUP BY p.id, p.name, p.cash_balance, p.total_value, p.unrealized_pnl, p.realized_pnl, p.last_updated;