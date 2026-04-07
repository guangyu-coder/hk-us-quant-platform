ALTER TABLE backtest_runs
    ADD COLUMN IF NOT EXISTS experiment_id UUID,
    ADD COLUMN IF NOT EXISTS experiment_label TEXT,
    ADD COLUMN IF NOT EXISTS experiment_note TEXT,
    ADD COLUMN IF NOT EXISTS parameter_version TEXT;

CREATE INDEX IF NOT EXISTS idx_backtest_runs_experiment_id
    ON backtest_runs (experiment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_parameter_version
    ON backtest_runs (parameter_version, created_at DESC);
