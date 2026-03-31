-- Data archival schema for HK-US Quantitative Trading Platform
-- This migration adds tables for long-term data storage and archival

-- Market data archive table
CREATE TABLE IF NOT EXISTS market_data_archive (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    price DECIMAL(18,6) NOT NULL,
    volume BIGINT NOT NULL,
    bid_price DECIMAL(18,6),
    ask_price DECIMAL(18,6),
    bid_size BIGINT,
    ask_size BIGINT,
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient archival data querying
CREATE INDEX idx_market_data_archive_symbol ON market_data_archive (symbol);
CREATE INDEX idx_market_data_archive_timestamp ON market_data_archive (timestamp DESC);
CREATE INDEX idx_market_data_archive_archived_at ON market_data_archive (archived_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_data_archive_symbol_timestamp
    ON market_data_archive (symbol, timestamp);

-- Orders archive table
CREATE TABLE IF NOT EXISTS orders_archive (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    price DECIMAL(18,6),
    order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED')),
    strategy_id VARCHAR(50),
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient order archival querying
CREATE INDEX idx_orders_archive_order_id ON orders_archive (order_id);
CREATE INDEX idx_orders_archive_symbol ON orders_archive (symbol);
CREATE INDEX idx_orders_archive_status ON orders_archive (status);
CREATE INDEX idx_orders_archive_archived_at ON orders_archive (archived_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_archive_order_id
    ON orders_archive (order_id);

-- Trades archive table
CREATE TABLE IF NOT EXISTS trades_archive (
    id BIGSERIAL PRIMARY KEY,
    trade_id UUID NOT NULL,
    order_id UUID,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    quantity BIGINT NOT NULL,
    price DECIMAL(18,6) NOT NULL,
    executed_at TIMESTAMPTZ,
    portfolio_id VARCHAR(50),
    strategy_id VARCHAR(50),
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

-- Create indexes for efficient trade archival querying
CREATE INDEX idx_trades_archive_trade_id ON trades_archive (trade_id);
CREATE INDEX idx_trades_archive_symbol ON trades_archive (symbol);
CREATE INDEX idx_trades_archive_archived_at ON trades_archive (archived_at DESC);

-- Create archive metadata table for tracking archival operations
CREATE TABLE IF NOT EXISTS archival_metadata (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('CLEANUP', 'ARCHIVAL')),
    records_processed BIGINT NOT NULL,
    cutoff_date TIMESTAMPTZ NOT NULL,
    archived_count BIGINT,
    deleted_count BIGINT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for archival metadata querying
CREATE INDEX idx_archival_metadata_table ON archival_metadata (table_name);
CREATE INDEX idx_archival_metadata_status ON archival_metadata (status);
CREATE INDEX idx_archival_metadata_started_at ON archival_metadata (started_at DESC);

-- Create a function to archive old market data
CREATE OR REPLACE FUNCTION archive_old_market_data(cutoff_date TIMESTAMPTZ)
RETURNS BIGINT AS $$
DECLARE
    archived_count BIGINT;
BEGIN
    -- Insert data into archive table
    INSERT INTO market_data_archive (
        symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size, archived_at
    )
    SELECT 
        symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size, NOW()
    FROM market_data
    WHERE timestamp < cutoff_date
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS archived_count = ROW_COUNT;

    -- Delete archived data from main table
    DELETE FROM market_data WHERE timestamp < cutoff_date;

    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to archive old orders
CREATE OR REPLACE FUNCTION archive_old_orders(cutoff_date TIMESTAMPTZ)
RETURNS BIGINT AS $$
DECLARE
    archived_count BIGINT;
BEGIN
    -- Insert data into archive table
    INSERT INTO orders_archive (
        order_id, symbol, side, quantity, price, order_type, status, strategy_id, archived_at
    )
    SELECT 
        order_id, symbol, side, quantity, price, order_type, status, strategy_id, NOW()
    FROM orders
    WHERE created_at < cutoff_date
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS archived_count = ROW_COUNT;

    -- Delete archived data from main table
    DELETE FROM orders WHERE created_at < cutoff_date;

    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to archive old trades
CREATE OR REPLACE FUNCTION archive_old_trades(cutoff_date TIMESTAMPTZ)
RETURNS BIGINT AS $$
DECLARE
    archived_count BIGINT;
BEGIN
    -- Insert data into archive table
    INSERT INTO trades_archive (
        trade_id, order_id, symbol, side, quantity, price, executed_at, portfolio_id, strategy_id, archived_at
    )
    SELECT 
        id::UUID, order_id, symbol, side, quantity, price, executed_at, portfolio_id, strategy_id, NOW()
    FROM trades
    WHERE executed_at < cutoff_date
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS archived_count = ROW_COUNT;

    -- Delete archived data from main table
    DELETE FROM trades WHERE executed_at < cutoff_date;

    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to log archival operations
CREATE OR REPLACE FUNCTION log_archival_operation(
    p_table_name VARCHAR(50),
    p_operation_type VARCHAR(20),
    p_records_processed BIGINT,
    p_cutoff_date TIMESTAMPTZ,
    p_archived_count BIGINT,
    p_deleted_count BIGINT,
    p_status VARCHAR(20),
    p_error_message TEXT DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
    new_id BIGINT;
BEGIN
    INSERT INTO archival_metadata (
        table_name, operation_type, records_processed, cutoff_date, 
        archived_count, deleted_count, status, error_message
    ) VALUES (
        p_table_name, p_operation_type, p_records_processed, p_cutoff_date,
        p_archived_count, p_deleted_count, p_status, p_error_message
    )
    RETURNING id INTO new_id;
    
    RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to run archival (requires pg_cron extension)
-- SELECT cron.schedule('daily-archival', '0 2 * * *', 
--     'SELECT archive_old_market_data(NOW() - INTERVAL ''30 days'');');
-- SELECT cron.schedule('daily-archival-orders', '0 3 * * *', 
--     'SELECT archive_old_orders(NOW() - INTERVAL ''90 days'');');

-- Create a view for archival statistics
CREATE VIEW archival_statistics AS
SELECT 
    table_name,
    operation_type,
    COUNT(*) as operation_count,
    SUM(records_processed) as total_records_processed,
    SUM(archived_count) as total_archived,
    SUM(deleted_count) as total_deleted,
    AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds,
    MIN(started_at) as first_operation,
    MAX(started_at) as last_operation
FROM archival_metadata
WHERE status = 'COMPLETED'
GROUP BY table_name, operation_type;

-- Create a function to restore data from archive (for data recovery)
CREATE OR REPLACE FUNCTION restore_from_archive(
    p_table_name VARCHAR(50),
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS TABLE (restored_count BIGINT) AS $$
BEGIN
    IF p_table_name = 'market_data' THEN
        RETURN QUERY
        WITH inserted AS (
            INSERT INTO market_data (symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size)
            SELECT symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size
            FROM market_data_archive
            WHERE timestamp BETWEEN p_start_date AND p_end_date
            ON CONFLICT (symbol, timestamp) DO UPDATE SET
                price = EXCLUDED.price,
                volume = EXCLUDED.volume,
                bid_price = EXCLUDED.bid_price,
                ask_price = EXCLUDED.ask_price,
                bid_size = EXCLUDED.bid_size,
                ask_size = EXCLUDED.ask_size
            RETURNING 1
        )
        SELECT COUNT(*)::BIGINT FROM inserted;
    ELSIF p_table_name = 'orders' THEN
        RETURN QUERY
        WITH inserted AS (
            INSERT INTO orders (order_id, symbol, side, quantity, price, order_type, status, strategy_id)
            SELECT order_id, symbol, side, quantity, price, order_type, status, strategy_id
            FROM orders_archive
            WHERE archived_at BETWEEN p_start_date AND p_end_date
            ON CONFLICT (order_id) DO UPDATE SET
                status = EXCLUDED.status,
                updated_at = NOW()
            RETURNING 1
        )
        SELECT COUNT(*)::BIGINT FROM inserted;
    ELSE
        RETURN QUERY SELECT 0::BIGINT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Add compression policy for archived data (optional, requires TimescaleDB)
-- ALTER TABLE market_data_archive SET (
--     timescaledb.compress,
--     timescaledb.compress_segmentby = 'symbol'
-- );

-- Add retention policy for archival metadata (keep 2 years)
-- SELECT add_retention_policy('archival_metadata', INTERVAL '2 years');
