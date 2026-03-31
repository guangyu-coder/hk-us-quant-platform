-- Backtest run history for HK-US Quantitative Trading Platform

CREATE TABLE IF NOT EXISTS backtest_runs (
    id UUID PRIMARY KEY,
    strategy_id VARCHAR(50) NOT NULL,
    strategy_name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(20) NOT NULL,
    parameters JSONB NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    initial_capital DECIMAL(18,6) NOT NULL,
    final_capital DECIMAL(18,6) NOT NULL,
    total_return DOUBLE PRECISION NOT NULL,
    annualized_return DOUBLE PRECISION NOT NULL,
    sharpe_ratio DOUBLE PRECISION NOT NULL,
    max_drawdown DOUBLE PRECISION NOT NULL,
    win_rate DOUBLE PRECISION NOT NULL,
    total_trades INTEGER NOT NULL,
    performance_metrics JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
);

CREATE INDEX idx_backtest_runs_strategy_created_at
    ON backtest_runs (strategy_id, created_at DESC);

CREATE INDEX idx_backtest_runs_created_at
    ON backtest_runs (created_at DESC);
