ALTER TABLE portfolio_backtest_configs
    ALTER COLUMN initial_capital TYPE DECIMAL(18,6) USING initial_capital::DECIMAL(18,6),
    ALTER COLUMN fee_bps TYPE DECIMAL(18,6) USING fee_bps::DECIMAL(18,6),
    ALTER COLUMN slippage_bps TYPE DECIMAL(18,6) USING slippage_bps::DECIMAL(18,6);

ALTER TABLE portfolio_backtest_runs
    ADD COLUMN IF NOT EXISTS final_capital DECIMAL(18,6);

ALTER TABLE portfolio_backtest_runs
    ALTER COLUMN initial_capital TYPE DECIMAL(18,6) USING initial_capital::DECIMAL(18,6),
    ALTER COLUMN total_return TYPE DECIMAL(18,6) USING total_return::DECIMAL(18,6),
    ALTER COLUMN annualized_return TYPE DECIMAL(18,6) USING annualized_return::DECIMAL(18,6),
    ALTER COLUMN max_drawdown TYPE DECIMAL(18,6) USING max_drawdown::DECIMAL(18,6),
    ALTER COLUMN sharpe_ratio TYPE DECIMAL(18,6) USING sharpe_ratio::DECIMAL(18,6),
    ALTER COLUMN volatility TYPE DECIMAL(18,6) USING volatility::DECIMAL(18,6),
    ALTER COLUMN final_capital TYPE DECIMAL(18,6) USING final_capital::DECIMAL(18,6);

ALTER TABLE portfolio_backtest_holdings
    ALTER COLUMN quantity TYPE DECIMAL(18,6) USING quantity::DECIMAL(18,6),
    ALTER COLUMN price TYPE DECIMAL(18,6) USING price::DECIMAL(18,6),
    ALTER COLUMN market_value TYPE DECIMAL(18,6) USING market_value::DECIMAL(18,6),
    ALTER COLUMN weight TYPE DECIMAL(18,6) USING weight::DECIMAL(18,6);

ALTER TABLE portfolio_backtest_rebalances
    ALTER COLUMN pre_weight TYPE DECIMAL(18,6) USING pre_weight::DECIMAL(18,6),
    ALTER COLUMN target_weight TYPE DECIMAL(18,6) USING target_weight::DECIMAL(18,6),
    ALTER COLUMN post_weight TYPE DECIMAL(18,6) USING post_weight::DECIMAL(18,6),
    ALTER COLUMN trade_value TYPE DECIMAL(18,6) USING trade_value::DECIMAL(18,6),
    ALTER COLUMN quantity_delta TYPE DECIMAL(18,6) USING quantity_delta::DECIMAL(18,6),
    ALTER COLUMN fee_cost TYPE DECIMAL(18,6) USING fee_cost::DECIMAL(18,6),
    ALTER COLUMN slippage_cost TYPE DECIMAL(18,6) USING slippage_cost::DECIMAL(18,6);

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

UPDATE portfolio_backtest_configs
SET rebalancing_frequency = CASE
    WHEN LOWER(TRIM(rebalancing_frequency)) IN ('daily', 'weekly', 'monthly')
        THEN LOWER(TRIM(rebalancing_frequency))
    ELSE 'monthly'
END
WHERE rebalancing_frequency IS DISTINCT FROM CASE
    WHEN LOWER(TRIM(rebalancing_frequency)) IN ('daily', 'weekly', 'monthly')
        THEN LOWER(TRIM(rebalancing_frequency))
    ELSE 'monthly'
END;

UPDATE portfolio_backtest_configs AS configs
SET assets = normalized.assets
FROM (
    SELECT
        existing.id,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'symbol', UPPER(TRIM(COALESCE(asset ->> 'symbol', ''))),
                    'display_name', BTRIM(COALESCE(asset ->> 'display_name', '')),
                    'market', UPPER(TRIM(COALESCE(asset ->> 'market', ''))),
                    'instrument_type', BTRIM(COALESCE(asset ->> 'instrument_type', '')),
                    'target_weight', COALESCE(asset -> 'target_weight', '0'::jsonb)
                )
                ORDER BY ordinality
            ) FILTER (WHERE asset IS NOT NULL),
            '[]'::jsonb
        ) AS assets
    FROM portfolio_backtest_configs AS existing
    LEFT JOIN LATERAL jsonb_array_elements(existing.assets) WITH ORDINALITY AS expanded(asset, ordinality)
        ON TRUE
    GROUP BY existing.id
) AS normalized
WHERE configs.id = normalized.id
  AND configs.assets IS DISTINCT FROM normalized.assets;

UPDATE portfolio_backtest_runs
SET status = CASE
    WHEN LOWER(TRIM(status)) IN ('pending', 'running', 'completed', 'failed')
        THEN LOWER(TRIM(status))
    ELSE 'failed'
END
WHERE status IS DISTINCT FROM CASE
    WHEN LOWER(TRIM(status)) IN ('pending', 'running', 'completed', 'failed')
        THEN LOWER(TRIM(status))
    ELSE 'failed'
END;

UPDATE portfolio_backtest_rebalances
SET action = CASE
    WHEN LOWER(TRIM(action)) IN ('buy', 'sell', 'hold')
        THEN LOWER(TRIM(action))
    ELSE 'hold'
END
WHERE action IS DISTINCT FROM CASE
    WHEN LOWER(TRIM(action)) IN ('buy', 'sell', 'hold')
        THEN LOWER(TRIM(action))
    ELSE 'hold'
END;

WITH deduped_holdings AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY run_id, holding_date, symbol
            ORDER BY created_at ASC, id ASC
        ) AS duplicate_rank
    FROM portfolio_backtest_holdings
)
DELETE FROM portfolio_backtest_holdings
WHERE id IN (
    SELECT id
    FROM deduped_holdings
    WHERE duplicate_rank > 1
);

WITH deduped_rebalances AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY run_id, rebalance_date, symbol, action
            ORDER BY created_at ASC, id ASC
        ) AS duplicate_rank
    FROM portfolio_backtest_rebalances
)
DELETE FROM portfolio_backtest_rebalances
WHERE id IN (
    SELECT id
    FROM deduped_rebalances
    WHERE duplicate_rank > 1
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'portfolio_backtest_configs_frequency_check'
          AND conrelid = 'portfolio_backtest_configs'::regclass
    ) THEN
        ALTER TABLE portfolio_backtest_configs
            ADD CONSTRAINT portfolio_backtest_configs_frequency_check
            CHECK (rebalancing_frequency IN ('daily', 'weekly', 'monthly'))
            NOT VALID;

        ALTER TABLE portfolio_backtest_configs
            VALIDATE CONSTRAINT portfolio_backtest_configs_frequency_check;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'portfolio_backtest_runs_status_check'
          AND conrelid = 'portfolio_backtest_runs'::regclass
    ) THEN
        ALTER TABLE portfolio_backtest_runs
            ADD CONSTRAINT portfolio_backtest_runs_status_check
            CHECK (status IN ('pending', 'running', 'completed', 'failed'))
            NOT VALID;

        ALTER TABLE portfolio_backtest_runs
            VALIDATE CONSTRAINT portfolio_backtest_runs_status_check;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'portfolio_backtest_rebalances_action_check'
          AND conrelid = 'portfolio_backtest_rebalances'::regclass
    ) THEN
        ALTER TABLE portfolio_backtest_rebalances
            ADD CONSTRAINT portfolio_backtest_rebalances_action_check
            CHECK (action IN ('buy', 'sell', 'hold'))
            NOT VALID;

        ALTER TABLE portfolio_backtest_rebalances
            VALIDATE CONSTRAINT portfolio_backtest_rebalances_action_check;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'portfolio_backtest_holdings_unique_run_date_symbol'
          AND conrelid = 'portfolio_backtest_holdings'::regclass
    ) THEN
        ALTER TABLE portfolio_backtest_holdings
            ADD CONSTRAINT portfolio_backtest_holdings_unique_run_date_symbol
            UNIQUE (run_id, holding_date, symbol);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'portfolio_backtest_rebalances_unique_run_date_symbol_action'
          AND conrelid = 'portfolio_backtest_rebalances'::regclass
    ) THEN
        ALTER TABLE portfolio_backtest_rebalances
            ADD CONSTRAINT portfolio_backtest_rebalances_unique_run_date_symbol_action
            UNIQUE (run_id, rebalance_date, symbol, action);
    END IF;
END
$$;
