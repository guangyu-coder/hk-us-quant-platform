CREATE TABLE IF NOT EXISTS signal_reviews (
    id UUID PRIMARY KEY,
    strategy_id VARCHAR(50) NOT NULL,
    strategy_name VARCHAR(100),
    symbol VARCHAR(20),
    timeframe VARCHAR(20),
    signal_type VARCHAR(20),
    strength DOUBLE PRECISION,
    generated_at TIMESTAMPTZ NOT NULL,
    source VARCHAR(100) NOT NULL,
    confirmation_state VARCHAR(50) NOT NULL DEFAULT 'manual_review_only',
    note TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    user_note TEXT,
    suggested_order JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_reviews_strategy_status_updated_at
    ON signal_reviews (strategy_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_reviews_status_updated_at
    ON signal_reviews (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_reviews_generated_at
    ON signal_reviews (generated_at DESC);
