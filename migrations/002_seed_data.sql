-- Seed data for testing the HK-US Quantitative Trading Platform

-- Insert sample strategies
INSERT INTO strategies (strategy_id, name, description, config, is_active) VALUES
('sma-crossover', 'SMA Crossover', 'Simple Moving Average Crossover Strategy', 
 '{"short_period": 5, "long_period": 20, "timeframe": "1d"}'::jsonb, TRUE),
('mean-reversion', 'Mean Reversion', 'Mean Reversion Trading Strategy',
 '{"lookback_period": 20, "threshold": 2.0}'::jsonb, TRUE),
('momentum', 'Momentum Strategy', 'Trend Following Momentum Strategy',
 '{"momentum_period": 14, "threshold": 0.02}'::jsonb, FALSE);

-- Insert sample positions for default portfolio
INSERT INTO positions (portfolio_id, symbol, quantity, average_cost) VALUES
('default', 'AAPL', 100, 150.00),
('default', 'GOOGL', 10, 2800.00),
('default', 'MSFT', 50, 380.00),
('default', 'TSLA', 20, 250.00),
('default', '0700.HK', 100, 320.00);

-- Insert sample orders
INSERT INTO orders (order_id, symbol, side, quantity, price, order_type, status, strategy_id) VALUES
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'AAPL', 'BUY', 50, 155.00, 'LIMIT', 'FILLED', 'sma-crossover'),
('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'GOOGL', 'BUY', 5, 2850.00, 'LIMIT', 'PENDING', 'mean-reversion'),
('c3d4e5f6-a7b8-9012-cdef-123456789012', 'MSFT', 'SELL', 25, 390.00, 'LIMIT', 'SUBMITTED', 'momentum');

-- Insert sample trades
INSERT INTO trades (order_id, symbol, side, quantity, price, portfolio_id, strategy_id) VALUES
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'AAPL', 'BUY', 50, 152.50, 'default', 'sma-crossover'),
('c3d4e5f6-a7b8-9012-cdef-123456789012', 'MSFT', 'BUY', 25, 375.00, 'default', 'momentum');

-- Insert risk alerts
INSERT INTO risk_alerts (alert_type, message, severity) VALUES
('position_limit', 'Position in AAPL exceeds 10% of portfolio', 'MEDIUM'),
('drawdown', 'Daily drawdown exceeded 5%', 'HIGH'),
('volume_spike', 'Unusual volume detected in TSLA', 'LOW');

-- Insert performance metrics for the last 7 days
INSERT INTO performance_metrics (portfolio_id, strategy_id, date, total_pnl, realized_pnl, unrealized_pnl, total_return, sharpe_ratio, max_drawdown)
SELECT 
    'default',
    'sma-crossover',
    CURRENT_DATE - (i || ' days')::interval,
    1000 + (random() * 500 - 250),
    800 + (random() * 200 - 100),
    200 + (random() * 100 - 50),
    0.01 + (random() * 0.02 - 0.01),
    1.0 + (random() * 1.0 - 0.5),
    0.02 + (random() * 0.03 - 0.015)
FROM generate_series(0, 6) AS i;

-- Insert market data for the last 30 days
INSERT INTO market_data (symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size)
SELECT 
    symbol,
    NOW() - (i || ' minutes')::interval,
    base_price * (1 + (random() * 0.02 - 0.01)),
    FLOOR(random() * 1000000 + 100000),
    base_price * (1 + (random() * 0.001 - 0.0005)),
    base_price * (1 + (random() * 0.001 + 0.0005)),
    FLOOR(random() * 1000 + 100),
    FLOOR(random() * 1000 + 100)
FROM (VALUES 
    ('AAPL', 150.00),
    ('GOOGL', 2800.00),
    ('MSFT', 380.00),
    ('TSLA', 250.00),
    ('0700.HK', 320.00)
) AS stocks(symbol, base_price)
CROSS JOIN generate_series(0, 43200) AS i;

-- Update portfolio value based on positions
UPDATE portfolios 
SET total_value = cash_balance + (
    SELECT COALESCE(SUM(quantity * average_cost), 0)
    FROM positions 
    WHERE portfolio_id = 'default'
),
unrealized_pnl = (
    SELECT COALESCE(SUM(quantity * (average_cost - 150.00)), 0)
    FROM positions 
    WHERE portfolio_id = 'default'
);

-- Create user sessions table for authentication (future use)
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id UUID PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    token VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_token ON user_sessions (token);
CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);

-- Create audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(50),
    details JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user ON audit_log (user_id);
CREATE INDEX idx_audit_log_action ON audit_log (action);
CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC);
