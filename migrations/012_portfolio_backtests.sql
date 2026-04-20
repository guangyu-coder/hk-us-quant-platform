CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS portfolio_backtest_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    initial_capital DECIMAL(18,6) NOT NULL,
    fee_bps DECIMAL(18,6) NOT NULL,
    slippage_bps DECIMAL(18,6) NOT NULL,
    rebalancing_frequency TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    assets JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT portfolio_backtest_configs_frequency_check
        CHECK (rebalancing_frequency IN ('daily', 'weekly', 'monthly'))
);

CREATE OR REPLACE FUNCTION set_portfolio_backtest_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_portfolio_backtest_configs_updated_at ON portfolio_backtest_configs;
CREATE TRIGGER trg_portfolio_backtest_configs_updated_at
BEFORE UPDATE ON portfolio_backtest_configs
FOR EACH ROW
EXECUTE FUNCTION set_portfolio_backtest_configs_updated_at();

CREATE TABLE IF NOT EXISTS portfolio_backtest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES portfolio_backtest_configs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    initial_capital DECIMAL(18,6) NOT NULL,
    final_capital DECIMAL(18,6),
    total_return DECIMAL(18,6),
    annualized_return DECIMAL(18,6),
    max_drawdown DECIMAL(18,6),
    sharpe_ratio DECIMAL(18,6),
    volatility DECIMAL(18,6),
    equity_curve JSONB,
    summary JSONB,
    error_message TEXT,
    CONSTRAINT portfolio_backtest_runs_status_check
        CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS portfolio_backtest_holdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES portfolio_backtest_runs(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    holding_date DATE NOT NULL,
    quantity DECIMAL(18,6) NOT NULL,
    price DECIMAL(18,6) NOT NULL,
    market_value DECIMAL(18,6) NOT NULL,
    weight DECIMAL(18,6) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT portfolio_backtest_holdings_unique_run_date_symbol
        UNIQUE (run_id, holding_date, symbol)
);

CREATE TABLE IF NOT EXISTS portfolio_backtest_rebalances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES portfolio_backtest_runs(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    rebalance_date DATE NOT NULL,
    action TEXT NOT NULL,
    pre_weight DECIMAL(18,6) NOT NULL,
    target_weight DECIMAL(18,6) NOT NULL,
    post_weight DECIMAL(18,6) NOT NULL,
    trade_value DECIMAL(18,6) NOT NULL,
    quantity_delta DECIMAL(18,6) NOT NULL,
    fee_cost DECIMAL(18,6) NOT NULL,
    slippage_cost DECIMAL(18,6) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT portfolio_backtest_rebalances_action_check
        CHECK (action IN ('buy', 'sell', 'hold')),
    CONSTRAINT portfolio_backtest_rebalances_unique_run_date_symbol_action
        UNIQUE (run_id, rebalance_date, symbol, action)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_backtest_configs_active_frequency
    ON portfolio_backtest_configs (is_active, rebalancing_frequency, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_backtest_runs_config_id
    ON portfolio_backtest_runs (config_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_backtest_holdings_run_date
    ON portfolio_backtest_holdings (run_id, holding_date, symbol);

CREATE INDEX IF NOT EXISTS idx_portfolio_backtest_rebalances_run_date
    ON portfolio_backtest_rebalances (run_id, rebalance_date, symbol);
