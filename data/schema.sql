-- Instruments table: Stores metadata about tradable assets
CREATE TABLE IF NOT EXISTS instruments (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL,
    exchange VARCHAR(32) NOT NULL,  -- e.g., 'HKEX', 'NASDAQ', 'NYSE'
    sec_type VARCHAR(16) NOT NULL,  -- e.g., 'STK', 'FUT', 'OPT'
    currency VARCHAR(8) NOT NULL,
    name VARCHAR(255),
    UNIQUE(symbol, exchange)
);

-- Strategies table: Registry of running strategies
CREATE TABLE IF NOT EXISTS strategies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Market Data table: Historical and real-time OHLCV data
-- Ideally, use TimescaleDB hypertable for this if available
CREATE TABLE IF NOT EXISTS market_data (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    instrument_id INTEGER REFERENCES instruments(id),
    open NUMERIC(18, 6) NOT NULL,
    high NUMERIC(18, 6) NOT NULL,
    low NUMERIC(18, 6) NOT NULL,
    close NUMERIC(18, 6) NOT NULL,
    volume NUMERIC(18, 2),
    PRIMARY KEY (time, instrument_id)
);

-- Trades table: Record of executed trades
CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    instrument_id INTEGER REFERENCES instruments(id),
    strategy_id INTEGER REFERENCES strategies(id),
    side VARCHAR(4) NOT NULL, -- 'BUY' or 'SELL'
    quantity NUMERIC(18, 6) NOT NULL,
    price NUMERIC(18, 6) NOT NULL,
    commission NUMERIC(18, 6) DEFAULT 0,
    order_id VARCHAR(64) -- Broker order ID reference
);

-- Equity Curve: Track daily/periodic account value
CREATE TABLE IF NOT EXISTS equity_curve (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    strategy_id INTEGER REFERENCES strategies(id),
    total_equity NUMERIC(18, 6) NOT NULL,
    cash_balance NUMERIC(18, 6) NOT NULL,
    PRIMARY KEY (time, strategy_id)
);
