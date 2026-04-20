CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS market_symbols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL UNIQUE,
    instrument_name TEXT NOT NULL,
    market TEXT NOT NULL,
    exchange TEXT NOT NULL,
    country TEXT NOT NULL,
    instrument_type TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'import',
    aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT market_symbols_market_check CHECK (market IN ('US', 'HK')),
    CONSTRAINT market_symbols_instrument_type_check CHECK (instrument_type IN ('Common Stock', 'ETF'))
);

CREATE INDEX IF NOT EXISTS idx_market_symbols_market_type_active
    ON market_symbols (market, instrument_type, is_active);

CREATE INDEX IF NOT EXISTS idx_market_symbols_market_exchange_type_active
    ON market_symbols (market, exchange, instrument_type, is_active);

CREATE INDEX IF NOT EXISTS idx_market_symbols_exchange
    ON market_symbols (exchange);

CREATE INDEX IF NOT EXISTS idx_market_symbols_name
    ON market_symbols (instrument_name);

CREATE INDEX IF NOT EXISTS idx_market_symbols_aliases
    ON market_symbols USING GIN (aliases);

CREATE TABLE IF NOT EXISTS market_movers_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market TEXT NOT NULL,
    instrument_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    symbol TEXT NOT NULL,
    instrument_name TEXT NOT NULL,
    exchange TEXT NOT NULL,
    country TEXT NOT NULL,
    price DOUBLE PRECISION,
    change DOUBLE PRECISION,
    change_percent DOUBLE PRECISION,
    currency TEXT,
    rank INTEGER NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL DEFAULT 'import',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT market_movers_snapshots_market_check CHECK (market IN ('US', 'HK')),
    CONSTRAINT market_movers_snapshots_instrument_type_check CHECK (instrument_type IN ('Common Stock', 'ETF')),
    CONSTRAINT market_movers_snapshots_direction_check CHECK (direction IN ('gainers', 'losers'))
);

CREATE INDEX IF NOT EXISTS idx_market_movers_lookup
    ON market_movers_snapshots (market, instrument_type, direction, captured_at DESC, rank ASC);

CREATE INDEX IF NOT EXISTS idx_market_movers_symbol_captured_at
    ON market_movers_snapshots (symbol, captured_at DESC);
