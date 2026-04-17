# Portfolio Backtest V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-version portfolio backtesting workflow that lets a user configure a fixed-weight multi-symbol portfolio, rebalance it on a daily/weekly/monthly schedule, and review a dedicated portfolio-level backtest report without disturbing the existing single-strategy backtest system.

**Architecture:** Keep the existing strategy backtest path untouched and introduce a parallel portfolio-backtest slice with its own config/run/report models, APIs, and frontend pages. Use daily historical prices only, validate weights strictly, and persist portfolio runs, holdings snapshots, and rebalance records in dedicated tables so the first version stays clear and extensible.

**Tech Stack:** Rust, Axum, SQLx, PostgreSQL/Timescale, Next.js App Router, TypeScript, React, Vitest, cargo test, Docker Compose.

---

## File Structure

- Create: `migrations/012_portfolio_backtests.sql`
  - Add portfolio backtest config/run/holding/rebalance tables and indexes
- Modify: `src/types.rs`
  - Add Rust types for portfolio configs, inputs, runs, metrics, holdings, and rebalance rows
- Modify: `src/main.rs`
  - Add portfolio backtest CRUD/run/report API handlers and targeted tests
- Create/Modify: `src/portfolio_backtest/mod.rs`
  - Implement portfolio validation, historical price alignment, execution, metrics, and persistence
- Modify: `src/market_data/mod.rs` or reuse existing historical data helpers carefully
  - Provide shared access to daily historical prices needed by portfolio backtest execution
- Modify: `frontend/src/lib/api.ts`
  - Add typed client methods for portfolio backtest config, run, list, and report endpoints
- Modify: `frontend/src/types/index.ts`
  - Add frontend types for portfolio configs, assets, runs, holdings, and rebalances
- Create: `frontend/src/app/portfolio-backtest/page.tsx`
  - Portfolio backtest list page with entry point
- Create: `frontend/src/app/portfolio-backtest/new/page.tsx`
  - Portfolio configuration page
- Create: `frontend/src/app/portfolio-backtest/runs/[runId]/page.tsx`
  - Portfolio backtest report page
- Create: `frontend/src/app/portfolio-backtest/_components/PortfolioBacktestForm.tsx`
  - Multi-asset weight configuration UI
- Create: `frontend/src/app/portfolio-backtest/_components/PortfolioBacktestReport.tsx`
  - Portfolio summary, metrics, holdings, and rebalance sections
- Create: `frontend/src/app/portfolio-backtest/portfolio-backtest-helpers.ts`
  - Weight validation, display formatting, and report helper logic
- Create: `frontend/tests/portfolio-backtest-helpers.test.ts`
  - Helper coverage for weight totals and validation
- Modify: `frontend/tests/ui-smoke.test.tsx`
  - Cover portfolio backtest create/run/report flow
- Modify: `src/portfolio/mod.rs` only if shared portfolio utility extraction is truly required
  - Do not mix portfolio execution history with new backtest persistence unless necessary
- Modify: `README.md`
  - Add portfolio backtest entry and user flow

---

## Delivery Strategy

This work should ship in four contained tasks:

1. Add dedicated persistence and backend domain types.
2. Implement execution and reporting logic with backend tests.
3. Add frontend pages and portfolio configuration/report UX.
4. Add smoke coverage, docs, and final verification.

Each task should land in a self-contained commit that leaves the system running and understandable.

---

### Task 1: Add portfolio backtest persistence and shared types

**Files:**
- Create: `migrations/012_portfolio_backtests.sql`
- Modify: `src/types.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Write the migration for portfolio backtest tables**

Create `migrations/012_portfolio_backtests.sql`:

```sql
CREATE TABLE IF NOT EXISTS portfolio_backtest_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    initial_capital DOUBLE PRECISION NOT NULL,
    fee_bps DOUBLE PRECISION NOT NULL,
    slippage_bps DOUBLE PRECISION NOT NULL,
    rebalancing_frequency TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    assets JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_backtest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES portfolio_backtest_configs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    initial_capital DOUBLE PRECISION NOT NULL,
    total_return DOUBLE PRECISION,
    annualized_return DOUBLE PRECISION,
    max_drawdown DOUBLE PRECISION,
    sharpe_ratio DOUBLE PRECISION,
    volatility DOUBLE PRECISION,
    equity_curve JSONB,
    summary JSONB,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_backtest_holdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES portfolio_backtest_runs(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    holding_date DATE NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    market_value DOUBLE PRECISION NOT NULL,
    weight DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_backtest_rebalances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES portfolio_backtest_runs(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    rebalance_date DATE NOT NULL,
    action TEXT NOT NULL,
    pre_weight DOUBLE PRECISION NOT NULL,
    target_weight DOUBLE PRECISION NOT NULL,
    post_weight DOUBLE PRECISION NOT NULL,
    trade_value DOUBLE PRECISION NOT NULL,
    quantity_delta DOUBLE PRECISION NOT NULL,
    fee_cost DOUBLE PRECISION NOT NULL,
    slippage_cost DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_backtest_runs_config_id
    ON portfolio_backtest_runs(config_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_backtest_holdings_run_date
    ON portfolio_backtest_holdings(run_id, holding_date, symbol);

CREATE INDEX IF NOT EXISTS idx_portfolio_backtest_rebalances_run_date
    ON portfolio_backtest_rebalances(run_id, rebalance_date, symbol);
```

- [ ] **Step 2: Add failing backend type-shape tests**

In `src/main.rs`, add tests that assert the portfolio config payload rejects:
- fewer than 2 assets
- total weight not equal to 1
- unsupported `rebalancing_frequency`

Use expectations like:

```rust
assert!(validate_portfolio_assets(&assets).is_err());
```

- [ ] **Step 3: Run the targeted backend tests to verify failure**

Run:

```bash
cargo test portfolio_backtest_ -- --nocapture
```

Expected: FAIL because portfolio validation/types do not exist yet.

- [ ] **Step 4: Add Rust types for configs, assets, and report summaries**

In `src/types.rs`, add explicit structs such as:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioAssetInput {
    pub symbol: String,
    pub display_name: String,
    pub market: String,
    pub instrument_type: String,
    pub target_weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioBacktestConfigInput {
    pub name: String,
    pub description: Option<String>,
    pub initial_capital: f64,
    pub fee_bps: f64,
    pub slippage_bps: f64,
    pub rebalancing_frequency: String,
    pub start_date: String,
    pub end_date: String,
    pub is_active: bool,
    pub assets: Vec<PortfolioAssetInput>,
}
```

Also add response structs for:
- config list/detail
- run summary
- holdings row
- rebalance row

- [ ] **Step 5: Implement minimal validation helpers**

Add helpers in `src/main.rs` or new backend module for:
- asset count >= 2
- each weight > 0
- sum of weights within small tolerance of `1.0`
- `daily | weekly | monthly` frequency only

Use a tolerance such as:

```rust
const WEIGHT_EPSILON: f64 = 0.0001;
```

- [ ] **Step 6: Re-run targeted tests to verify pass**

Run:

```bash
cargo test portfolio_backtest_ -- --nocapture
```

Expected: PASS for validation/type-shape tests.

- [ ] **Step 7: Commit**

```bash
git add migrations/012_portfolio_backtests.sql src/types.rs src/main.rs
git commit -m "feat: add portfolio backtest persistence"
```

---

### Task 2: Implement portfolio backtest execution and reporting logic

**Files:**
- Create: `src/portfolio_backtest/mod.rs`
- Modify: `src/main.rs`
- Modify: `src/types.rs`

- [ ] **Step 1: Write failing execution tests**

Add focused tests for:
- two-asset daily rebalanced portfolio
- weekly rebalance path
- missing historical data error

Use test names like:

```rust
#[tokio::test]
async fn portfolio_backtest_rebalances_two_assets_daily() {}

#[tokio::test]
async fn portfolio_backtest_returns_error_when_asset_history_missing() {}
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run:

```bash
cargo test portfolio_backtest_rebalances_two_assets_daily -- --nocapture
```

Expected: FAIL because execution engine does not exist yet.

- [ ] **Step 3: Implement the execution module**

Create `src/portfolio_backtest/mod.rs` with:
- daily historical series alignment
- initial allocation by target weights
- periodic rebalance trigger logic
- transaction cost application
- equity curve generation
- summary metric calculation

Include clearly bounded entrypoint shape such as:

```rust
pub async fn run_portfolio_backtest(
    db_pool: &PgPool,
    input: &PortfolioBacktestConfigInput,
) -> AppResult<PortfolioBacktestRunResponse> {
    // validate
    // load price history
    // align dates
    // simulate holdings and rebalances
    // persist run, holdings, rebalances
    // return report
}
```

- [ ] **Step 4: Persist runs, holdings, and rebalances**

Wire SQLx inserts for:
- `portfolio_backtest_runs`
- `portfolio_backtest_holdings`
- `portfolio_backtest_rebalances`

Ensure failed execution stores:
- `status = "failed"`
- `error_message`

Ensure successful execution stores:
- metrics
- equity curve JSON
- summary JSON

- [ ] **Step 5: Add API handlers**

In `src/main.rs`, add:
- `POST /api/v1/portfolio-backtests`
- `GET /api/v1/portfolio-backtests`
- `GET /api/v1/portfolio-backtests/:id`
- `POST /api/v1/portfolio-backtests/:id/run`
- `GET /api/v1/portfolio-backtests/runs/:run_id`

Each handler should use the new dedicated types and not share the single-strategy backtest code path.

- [ ] **Step 6: Run backend verification**

Run:

```bash
cargo test portfolio_backtest_ -- --nocapture
cargo test --no-run
```

Expected: targeted tests and compile checks pass.

- [ ] **Step 7: Commit**

```bash
git add src/portfolio_backtest/mod.rs src/main.rs src/types.rs
git commit -m "feat: add portfolio backtest execution engine"
```

---

### Task 3: Add portfolio backtest frontend pages and report UX

**Files:**
- Create: `frontend/src/app/portfolio-backtest/page.tsx`
- Create: `frontend/src/app/portfolio-backtest/new/page.tsx`
- Create: `frontend/src/app/portfolio-backtest/runs/[runId]/page.tsx`
- Create: `frontend/src/app/portfolio-backtest/_components/PortfolioBacktestForm.tsx`
- Create: `frontend/src/app/portfolio-backtest/_components/PortfolioBacktestReport.tsx`
- Create: `frontend/src/app/portfolio-backtest/portfolio-backtest-helpers.ts`
- Create: `frontend/tests/portfolio-backtest-helpers.test.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Write failing frontend helper tests**

Create `frontend/tests/portfolio-backtest-helpers.test.ts` with cases for:
- valid weight total
- invalid total > 100%
- invalid total < 100%
- fewer than 2 assets
- rebalance frequency label formatting

Example:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { validatePortfolioWeights } from "@/app/portfolio-backtest/portfolio-backtest-helpers";

test("validatePortfolioWeights rejects totals above one", () => {
  const result = validatePortfolioWeights([
    { symbol: "AAPL", targetWeight: 0.7 },
    { symbol: "MSFT", targetWeight: 0.4 },
  ]);

  assert.equal(result.valid, false);
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run:

```bash
cd frontend && node --test --experimental-strip-types tests/portfolio-backtest-helpers.test.ts
```

Expected: FAIL because helper file does not exist yet.

- [ ] **Step 3: Add typed frontend API and helpers**

In `frontend/src/types/index.ts`, add:
- `PortfolioAssetInput`
- `PortfolioBacktestConfig`
- `PortfolioBacktestRun`
- `PortfolioBacktestHolding`
- `PortfolioBacktestRebalance`

In `frontend/src/lib/api.ts`, add:
- `listPortfolioBacktests`
- `createPortfolioBacktest`
- `getPortfolioBacktest`
- `runPortfolioBacktest`
- `getPortfolioBacktestRun`

In `frontend/src/app/portfolio-backtest/portfolio-backtest-helpers.ts`, implement:
- weight total calculation
- validation result shape
- frequency labels
- percentage formatting

- [ ] **Step 4: Build the configuration UI**

Create `frontend/src/app/portfolio-backtest/_components/PortfolioBacktestForm.tsx` with:
- combination name
- description
- asset rows
- symbol search/select reuse where possible
- percentage weight inputs
- running total display
- invalid state messaging
- rebalance frequency select
- initial capital / fee / slippage / date range inputs

Create `frontend/src/app/portfolio-backtest/new/page.tsx` to host the form and submit create/run actions.

- [ ] **Step 5: Build list and report pages**

Create `frontend/src/app/portfolio-backtest/page.tsx` to show:
- existing portfolio configs
- recent runs
- button to create a new config

Create `frontend/src/app/portfolio-backtest/_components/PortfolioBacktestReport.tsx` and `frontend/src/app/portfolio-backtest/runs/[runId]/page.tsx` to show:
- summary card
- metrics
- equity curve
- target weights
- ending weights
- rebalance table

- [ ] **Step 6: Add navigation entry**

Update `frontend/src/components/layout/Sidebar.tsx` to include a `组合回测` navigation item pointing to `/portfolio-backtest`.

- [ ] **Step 7: Run frontend verification**

Run:

```bash
cd frontend && node --test --experimental-strip-types tests/portfolio-backtest-helpers.test.ts
cd frontend && npm run type-check
cd frontend && npm run lint
```

Expected: helper tests, type-check, and lint all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/portfolio-backtest frontend/src/lib/api.ts frontend/src/types/index.ts frontend/src/components/layout/Sidebar.tsx frontend/tests/portfolio-backtest-helpers.test.ts
git commit -m "feat: add portfolio backtest frontend workflow"
```

---

### Task 4: Add smoke coverage, docs, and final verification

**Files:**
- Modify: `frontend/tests/ui-smoke.test.tsx`
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT_SOP.md`

- [ ] **Step 1: Extend smoke coverage**

Add a smoke flow covering:
- open portfolio backtest page
- create config with 2 assets
- validate weight total
- run portfolio backtest
- open portfolio report

Use existing smoke utilities and mocks rather than introducing a parallel test harness.

- [ ] **Step 2: Run smoke verification**

Run:

```bash
cd frontend && npm run test:smoke
```

Expected: portfolio backtest flow passes alongside existing smoke tests.

- [ ] **Step 3: Update docs**

In `README.md`, add:
- portfolio backtest capability summary
- entry path
- supported first-version constraints:
  - fixed weights only
  - daily data only
  - daily/weekly/monthly rebalance only

In `docs/DEPLOYMENT_SOP.md`, add:
- a short smoke checklist item for `/portfolio-backtest`

- [ ] **Step 4: Run full verification**

Run:

```bash
cargo test --no-run
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```

Expected: all commands pass, or any pre-existing unrelated warning is explicitly noted.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/ui-smoke.test.tsx README.md docs/DEPLOYMENT_SOP.md
git commit -m "feat: verify and document portfolio backtest v1"
```

---

## Spec Coverage Check

- Portfolio fixed-weight multi-symbol configuration: covered in Task 1 and Task 3.
- Daily-only aligned historical execution model: covered in Task 2.
- Daily/weekly/monthly rebalancing: covered in Task 1 validation and Task 2 engine implementation.
- Dedicated portfolio config/run/report data model: covered in Task 1 and Task 2.
- Dedicated pages and report UX: covered in Task 3.
- Validation and explicit errors: covered in Task 1 and Task 3.
- Tests and smoke verification: covered in Tasks 1 through 4.

## Placeholder Scan

- No `TBD`, `TODO`, or “implement later” placeholders remain.
- Every task includes explicit files, concrete commands, and expected outcomes.
- Code snippets are included where a task introduces new structures or function boundaries.

## Type Consistency Check

- Backend names consistently use `PortfolioBacktest*`.
- Frontend names consistently mirror the same `PortfolioBacktest*` structure.
- Rebalancing frequency is consistently `daily | weekly | monthly`.
- Weight validation consistently treats the canonical backend value as decimal fractions summing to `1.0`.

