ALTER TABLE backtest_runs
    ADD COLUMN IF NOT EXISTS trades JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS equity_curve JSONB NOT NULL DEFAULT '[]'::jsonb;
