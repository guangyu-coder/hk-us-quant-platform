# Market Master Data And Movers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current sample-sized market universe with a scalable market master-data system so the app can browse full-market stock and ETF directories, paginate the “all” view, and serve gainers/losers from dedicated movers data instead of ad hoc in-memory symbol lists.

**Architecture:** Add a persistent `market_symbols` master-data table and a lightweight `market_movers_snapshots` store, then migrate the market list and search APIs to query those tables instead of relying on hard-coded built-in symbols. Keep real-time quotes online and on-demand, while treating symbol directories and movers snapshots as offline-managed data owned by explicit import/build steps.

**Tech Stack:** Rust, Axum, SQLx, PostgreSQL/Timescale, Python import scripts, Next.js App Router, TypeScript, React, Vitest, cargo test.

---

## File Structure

- Create: `migrations/010_market_symbols.sql`
  - Add `market_symbols` and `market_movers_snapshots` tables plus indexes
- Modify: `src/main.rs`
  - Replace built-in market list behavior with database-backed listing/search/movers endpoints
  - Add pagination and movers query parsing
  - Add tests for list pagination, instrument-type filtering, and movers output
- Modify: `src/types.rs`
  - Add Rust structs for market symbol records, list responses, and movers snapshots if shared types are needed
- Create: `scripts/import_market_symbols.py`
  - Import stock/ETF master data into `market_symbols`
  - Support US/HK first-pass symbol ingestion and active/inactive updates
- Create: `scripts/build_market_movers.py`
  - Generate gainers/losers snapshots from current symbol directories plus fetched quotes
- Modify: `frontend/src/lib/api.ts`
  - Add typed support for paginated market lists and movers endpoint
- Modify: `frontend/src/types/index.ts`
  - Add frontend types for market list pagination and movers responses
- Modify: `frontend/src/app/market/page.tsx`
  - Switch “all” mode to paginated directory browsing
  - Switch movers modes to API-driven snapshot loading
  - Add instrument-type filter
- Modify: `frontend/src/app/market/market-page-helpers.ts`
  - Add helper logic for instrument-type tabs and page-state handling only if still needed after API split
- Modify: `frontend/tests/market-page-helpers.test.ts`
  - Cover new page-state helper logic if introduced
- Modify: `frontend/tests/ui-smoke.test.tsx`
  - Cover paginated browsing, instrument-type filtering, and movers snapshot usage

### Task 1: Add database tables for market master data and movers snapshots

**Files:**
- Create: `migrations/010_market_symbols.sql`

- [ ] **Step 1: Write the migration with both tables and indexes**

Create `migrations/010_market_symbols.sql`:

```sql
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_symbols_market_type_active
    ON market_symbols (market, instrument_type, is_active);

CREATE INDEX IF NOT EXISTS idx_market_symbols_exchange
    ON market_symbols (exchange);

CREATE INDEX IF NOT EXISTS idx_market_symbols_name
    ON market_symbols (instrument_name);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_movers_lookup
    ON market_movers_snapshots (market, instrument_type, direction, captured_at DESC, rank ASC);
```

- [ ] **Step 2: Sanity-check migration syntax**

Run:

```bash
rg -n "CREATE TABLE IF NOT EXISTS market_symbols|CREATE TABLE IF NOT EXISTS market_movers_snapshots" migrations/010_market_symbols.sql
```

Expected: both table definitions are found.

- [ ] **Step 3: Commit**

```bash
git add migrations/010_market_symbols.sql
git commit -m "feat: add market master data tables"
```

### Task 2: Add master-data import script for US/HK stocks and ETFs

**Files:**
- Create: `scripts/import_market_symbols.py`

- [ ] **Step 1: Write the import script with explicit row normalization**

Create `scripts/import_market_symbols.py` with:
- CLI args for `--market`, `--source-file`, and `--db-url`
- normalization for:
  - symbol casing
  - HK numeric code padding to `.HK`
  - `Common Stock` / `ETF` instrument type restriction
- upsert behavior on `symbol`
- inactive-marking for symbols absent from the latest import batch per market/type/source

Include a focused normalization function in the script:

```python
def normalize_symbol(symbol: str, market: str) -> str:
    raw = symbol.strip().upper()
    if market == "HK":
        raw = raw.removesuffix(".HK")
        return f"{raw.zfill(4)}.HK"
    return raw
```

- [ ] **Step 2: Add a dry-run mode before database writes**

Ensure the script supports:

```bash
python3 scripts/import_market_symbols.py --market US --source-file /tmp/us_symbols.json --dry-run
```

Expected behavior: prints normalized row counts without touching the database.

- [ ] **Step 3: Add a small built-in fixture path for local verification**

Include support for simple JSON arrays of rows like:

```json
[
  {
    "symbol": "AAPL",
    "instrument_name": "Apple Inc.",
    "exchange": "NASDAQ",
    "country": "United States",
    "instrument_type": "Common Stock",
    "aliases": ["Apple"]
  }
]
```

- [ ] **Step 4: Run a dry-run verification**

Run:

```bash
python3 scripts/import_market_symbols.py --market US --source-file /tmp/us_symbols.json --dry-run
```

Expected: reports normalized rows and no exception.

- [ ] **Step 5: Commit**

```bash
git add scripts/import_market_symbols.py
git commit -m "feat: add market symbol import script"
```

### Task 3: Replace hard-coded market list behavior with database-backed listing and search

**Files:**
- Modify: `src/main.rs`
- Modify: `src/types.rs`

- [ ] **Step 1: Write failing backend tests for paginated list behavior**

Add tests near the current market list response tests in `src/main.rs` that assert:
- database-backed listing can filter by `market`
- database-backed listing can filter by `instrument_type`
- pagination returns a bounded page and total count

Use focused response-shaping expectations such as:

```rust
assert_eq!(response["page"], json!(1));
assert_eq!(response["page_size"], json!(50));
assert!(response["total"].as_u64().unwrap_or_default() >= 2);
```

- [ ] **Step 2: Run the targeted backend tests to verify failure**

Run:

```bash
cargo test market_list_response_ -- --nocapture
```

Expected: FAIL once tests are updated to expect pagination fields or DB-backed behavior.

- [ ] **Step 3: Add request/response structs for paginated market lists**

In `src/types.rs` or `src/main.rs`, define explicit shapes such as:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketSymbolRecord {
    pub symbol: String,
    pub instrument_name: String,
    pub market: String,
    pub exchange: String,
    pub country: String,
    pub instrument_type: String,
    pub aliases: Vec<String>,
    pub is_active: bool,
}
```

and a paginated response shape including:
- `success`
- `count`
- `total`
- `page`
- `page_size`
- `data`

- [ ] **Step 4: Implement DB-backed list and search queries**

Update `src/main.rs` so `/api/v1/market-data/list`:
- queries `market_symbols`
- supports `market`, `instrument_type`, `exchange`, `search`, `page`, `page_size`, `active_only`
- defaults to active rows only
- returns paginated results

Update search behavior so it queries `market_symbols` first instead of depending on provider search for directory discovery.

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
cargo test market_list_response_ -- --nocapture
cargo test built_in_market_list_response_ -- --nocapture
```

Expected: PASS after tests are updated to the new source of truth.

- [ ] **Step 6: Commit**

```bash
git add src/main.rs src/types.rs
git commit -m "feat: back market list with master data"
```

### Task 4: Add movers snapshot builder and movers endpoint

**Files:**
- Create: `scripts/build_market_movers.py`
- Modify: `src/main.rs`
- Modify: `src/types.rs`

- [ ] **Step 1: Write failing backend tests for movers responses**

Add tests that expect:
- `GET /api/v1/market-data/movers` shape includes `captured_at`
- result set respects `market`, `instrument_type`, and `direction`
- ranking order is stable by `rank`

Example expectation:

```rust
assert_eq!(response["direction"], json!("gainers"));
assert!(response["data"].as_array().unwrap().len() <= 100);
```

- [ ] **Step 2: Run targeted movers tests to verify failure**

Run:

```bash
cargo test market_movers_ -- --nocapture
```

Expected: FAIL because endpoint and snapshot store are missing.

- [ ] **Step 3: Write the snapshot build script**

Create `scripts/build_market_movers.py` that:
- reads active symbols from `market_symbols`
- fetches quotes in batches
- computes gainers/losers ordering by `change_percent`
- writes ranked rows into `market_movers_snapshots`
- supports `--market`, `--instrument-type`, and `--limit`

- [ ] **Step 4: Add the movers endpoint**

Update `src/main.rs` to add:

```rust
.route("/api/v1/market-data/movers", get(list_market_movers))
```

Implement `list_market_movers` to:
- read latest `captured_at` for the requested market/type/direction
- return ordered snapshot rows
- surface the snapshot timestamp and source in the response

- [ ] **Step 5: Run movers tests**

Run:

```bash
cargo test market_movers_ -- --nocapture
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/build_market_movers.py src/main.rs src/types.rs
git commit -m "feat: add market movers snapshot pipeline"
```

### Task 5: Update frontend API/types for paginated lists and movers snapshots

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add typed frontend response models**

In `frontend/src/types/index.ts`, define types for:
- paginated market symbol list response
- market symbol record
- movers response

Include fields the page actually needs:

```ts
export interface MarketSymbolRecord {
  symbol: string;
  instrument_name: string;
  market: 'US' | 'HK';
  exchange: string;
  country: string;
  instrument_type: 'Common Stock' | 'ETF';
  is_active: boolean;
}
```

- [ ] **Step 2: Update API helpers**

In `frontend/src/lib/api.ts`, add:
- paginated `getMarketList(...)`
- `getMarketMovers(...)`

Return fully typed responses instead of `Promise<any>`.

- [ ] **Step 3: Run frontend type-check**

Run:

```bash
cd frontend && npm run type-check
```

Expected: PASS or frontend compile errors that point to the remaining page updates.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/types/index.ts
git commit -m "feat: type market list and movers api"
```

### Task 6: Rework `/market` to use paginated “all” browsing plus API-driven movers

**Files:**
- Modify: `frontend/src/app/market/page.tsx`
- Modify: `frontend/src/app/market/market-page-helpers.ts`
- Modify: `frontend/tests/market-page-helpers.test.ts`
- Modify: `frontend/tests/ui-smoke.test.tsx`

- [ ] **Step 1: Write failing smoke expectations for pagination and instrument-type switching**

Extend `frontend/tests/ui-smoke.test.tsx` so the market page test expects:
- instrument-type filter: `普通股票` / `ETF`
- “全部” mode uses page controls
- “涨幅榜 / 跌幅榜” reads from movers API instead of client-side sorting alone

Example expectations:

```ts
expect(screen.getByRole('button', { name: '普通股票' })).toBeTruthy();
expect(screen.getByRole('button', { name: 'ETF' })).toBeTruthy();
expect(screen.getByRole('button', { name: '下一页' })).toBeTruthy();
```

- [ ] **Step 2: Run smoke test to verify failure**

Run:

```bash
cd frontend && npm run test:smoke
```

Expected: FAIL because the page has no instrument-type filter or pagination yet.

- [ ] **Step 3: Update the market page state model**

Refactor `frontend/src/app/market/page.tsx` so:
- `all` mode fetches paginated directory data
- `gainers` / `losers` mode fetches movers snapshots
- instrument-type filter is a first-class page state
- search stays scoped to the selected market/type
- current page resets when market or instrument type changes

Keep the row actions to `/market/chart` and `/market/orderbook`.

- [ ] **Step 4: Update or add helper coverage**

If the page gains new helper functions for page reset rules or instrument-type display state, add explicit tests in `frontend/tests/market-page-helpers.test.ts`.

- [ ] **Step 5: Run frontend verification**

Run:

```bash
cd frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/market/page.tsx frontend/src/app/market/market-page-helpers.ts frontend/tests/market-page-helpers.test.ts frontend/tests/ui-smoke.test.tsx
git commit -m "feat: paginate market universe and wire movers api"
```

### Task 7: Final regression sweep and rollout readiness

**Files:**
- Review all touched backend, migration, script, and frontend market files

- [ ] **Step 1: Run backend verification**

Run:

```bash
cargo test --no-run
```

Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run:

```bash
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
cd frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts
```

Expected: PASS

- [ ] **Step 3: Manual QA checklist**

Verify manually:
- `/market` can browse paginated US common stocks
- switch to HK and confirm pagination still works
- switch `普通股票 / ETF`
- switch `全部 / 涨幅榜 / 跌幅榜`
- search within current market/type
- click through to `/market/chart?symbol=...`
- click through to `/market/orderbook?symbol=...`

- [ ] **Step 4: Commit the finished slice**

```bash
git add migrations/010_market_symbols.sql scripts/import_market_symbols.py scripts/build_market_movers.py src/main.rs src/types.rs frontend/src/lib/api.ts frontend/src/types/index.ts frontend/src/app/market/page.tsx frontend/src/app/market/market-page-helpers.ts frontend/tests/market-page-helpers.test.ts frontend/tests/ui-smoke.test.tsx
git commit -m "feat: scale market module with master data and movers"
```

- [ ] **Step 5: Deployment readiness**

After review and approval, deploy with:

```bash
./scripts/deploy.sh refresh backend
./scripts/deploy.sh refresh frontend
./scripts/deploy.sh status
curl -fsS http://localhost:3002/health
```

Expected:
- backend and frontend refresh succeed
- services stay healthy
- `/market` loads paginated directories and movers data
