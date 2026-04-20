# Market Universe Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue expanding the stock and ETF universe for the market module so the app can browse a materially larger US/HK directory, feed movers snapshots from a broader master-data base, and make the expansion workflow repeatable instead of manual.

**Architecture:** Keep the existing `market_symbols` and `market_movers_snapshots` layered design, but strengthen three areas: larger source catalogs, more operationally useful import/build tooling, and clearer surface-level feedback about market size and real quote coverage. Directory updates remain offline-managed; real quotes remain online and movers continue to store only successful real data.

**Tech Stack:** Rust, Axum, SQLx, PostgreSQL/Timescale, Python import/build scripts, Next.js App Router, TypeScript, React, Vitest, cargo test, Docker Compose.

---

## File Structure

- Modify: `data/market_symbols.us.json`
  - Expand the US common-stock and ETF universe
- Modify: `data/market_symbols.hk.json`
  - Expand the HK common-stock and ETF universe
- Modify: `scripts/import_market_symbols.py`
  - Add stronger import summary output and repeatable execution ergonomics
- Modify: `scripts/build_market_movers.py`
  - Improve end-of-run summary for expansion coverage verification
- Modify: `scripts/test_build_market_movers.py`
  - Cover new summary semantics if adjusted
- Modify: `src/main.rs`
  - Surface larger market totals and coverage-oriented metadata cleanly
  - Add or adjust tests for expanded universe expectations where needed
- Modify: `frontend/src/app/market/page.tsx`
  - Improve total-count, page-range, and coverage communication for larger markets
- Modify: `frontend/src/app/market/market-page-helpers.ts`
  - Add helper logic for paging/coverage summaries when needed
- Modify: `frontend/tests/market-page-helpers.test.ts`
  - Cover any new count/coverage summary helpers
- Modify: `frontend/tests/ui-smoke.test.tsx`
  - Validate market totals, larger-page browsing, and coverage messaging
- Modify: `README.md`
  - Document the expanded universe workflow at a high level if user-facing behavior changes

---

## Delivery Strategy

This work should ship in three contained tasks:

1. Expand the source catalogs and make import/build tooling more operationally useful.
2. Improve backend and frontend reporting around market totals and coverage.
3. Run a real import/build pass, verify counts, and document the resulting workflow.

Each task should leave the system runnable and should make the next expansion pass easier than the last one.

---

### Task 1: Expand source catalogs and strengthen import/build tooling

**Files:**
- Modify: `data/market_symbols.us.json`
- Modify: `data/market_symbols.hk.json`
- Modify: `scripts/import_market_symbols.py`
- Modify: `scripts/build_market_movers.py`
- Modify: `scripts/test_build_market_movers.py`

- [ ] **Step 1: Expand the US and HK source catalogs**

Increase both JSON catalogs so they cover a materially larger set of:
- US common stocks
- US ETFs
- HK common stocks
- HK ETFs

Keep catalog rows normalized and structurally consistent:

```json
{
  "symbol": "AAPL",
  "instrument_name": "Apple Inc.",
  "exchange": "NASDAQ",
  "country": "United States",
  "instrument_type": "Common Stock",
  "aliases": ["Apple"]
}
```

- [ ] **Step 2: Enhance the import script summary**

Update `scripts/import_market_symbols.py` so it reports at least:
- total input rows
- normalized valid rows
- inserted rows
- updated rows
- unchanged rows
- inactive rows marked
- rejected rows summary
- grouped counts by `market` and `instrument_type`

The goal is to make each import pass easy to audit without reading the database manually.

- [ ] **Step 3: Strengthen dry-run output**

Ensure `--dry-run` prints the same high-signal summary structure as a real run, minus the database write.

Expected style:

```json
{
  "market": "US",
  "input_rows": 120,
  "normalized_rows": 118,
  "inserted": 0,
  "updated": 0,
  "inactive_marked": 0,
  "rejected": 2
}
```

- [ ] **Step 4: Make movers build output more useful for expansion verification**

Keep the existing coverage output, but ensure the script summary is explicit enough to verify expansion quality:
- `market`
- `instrument_type`
- `total_symbols`
- `covered`
- `missing`
- `success_rate`
- `rows_written`
- optional sample failures summary

- [ ] **Step 5: Run targeted script verification**

Run:

```bash
python3 -m unittest scripts/test_build_market_movers.py
python3 scripts/import_market_symbols.py --market US --source-file data/market_symbols.us.json --dry-run
python3 scripts/import_market_symbols.py --market HK --source-file data/market_symbols.hk.json --dry-run
```

Expected: PASS, with clear summary output and no malformed catalog rows.

- [ ] **Step 6: Commit**

```bash
git add data/market_symbols.us.json data/market_symbols.hk.json scripts/import_market_symbols.py scripts/build_market_movers.py scripts/test_build_market_movers.py
git commit -m "feat: expand market source catalogs"
```

---

### Task 2: Improve market totals and coverage visibility in backend and frontend

**Files:**
- Modify: `src/main.rs`
- Modify: `frontend/src/app/market/page.tsx`
- Modify: `frontend/src/app/market/market-page-helpers.ts`
- Modify: `frontend/tests/market-page-helpers.test.ts`
- Modify: `frontend/tests/ui-smoke.test.tsx`

- [ ] **Step 1: Add failing helper/UI expectations**

Add tests that assert the market page can clearly express:
- total stocks in the selected market/type
- current page range
- movers coverage summary
- empty-state distinction between:
  - no symbols in market/type
  - no rows after filters

Use helper-level assertions first where possible.

- [ ] **Step 2: Run frontend tests to verify failure**

Run:

```bash
cd frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts
cd frontend && npm run test:smoke
```

Expected: FAIL once the new expectations are added.

- [ ] **Step 3: Improve backend response clarity where needed**

Adjust `src/main.rs` response shaping if the frontend needs cleaner metadata, while preserving existing semantics. Examples:
- explicit total count usage for list mode
- stable coverage metadata for movers mode
- optional response notes only if they add clarity without making the API noisy

- [ ] **Step 4: Update market page summaries**

Update `frontend/src/app/market/page.tsx` so larger universes feel intentional:
- show total count more clearly
- show current page range like `第 1-50 / 320 只`
- show coverage summary in movers mode
- keep the wording explicit that movers only include real quote coverage successes

- [ ] **Step 5: Re-run frontend verification**

Run:

```bash
cd frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.rs frontend/src/app/market/page.tsx frontend/src/app/market/market-page-helpers.ts frontend/tests/market-page-helpers.test.ts frontend/tests/ui-smoke.test.tsx
git commit -m "feat: clarify market totals and movers coverage"
```

---

### Task 3: Run a real expansion pass and verify the enlarged market universe end-to-end

**Files:**
- Modify: `README.md` if workflow guidance changes

- [ ] **Step 1: Import the expanded market catalogs into `market_symbols`**

Run the real import workflow for both markets, for example:

```bash
python3 scripts/import_market_symbols.py --market US --source-file data/market_symbols.us.json --source-name catalog-us --db-url <DATABASE_URL>
python3 scripts/import_market_symbols.py --market HK --source-file data/market_symbols.hk.json --source-name catalog-hk --db-url <DATABASE_URL>
```

Expected: successful import summaries with materially larger totals than the current baseline.

- [ ] **Step 2: Rebuild movers snapshots from the enlarged symbol base**

Run:

```bash
python3 scripts/build_market_movers.py --market US --instrument-type "Common Stock" --db-url <DATABASE_URL> --limit 0
python3 scripts/build_market_movers.py --market US --instrument-type ETF --db-url <DATABASE_URL> --limit 0
python3 scripts/build_market_movers.py --market HK --instrument-type "Common Stock" --db-url <DATABASE_URL> --limit 0
python3 scripts/build_market_movers.py --market HK --instrument-type ETF --db-url <DATABASE_URL> --limit 0
```

Expected:
- larger `total_symbols`
- unchanged rule that only real quote successes enter snapshots
- coverage stats that honestly reflect quote availability

- [ ] **Step 3: Verify live API behavior**

Run checks such as:

```bash
curl -fsS "http://localhost:3002/api/v1/market-data/list?market=US&instrument_type=Common%20Stock&page=1&page_size=50"
curl -fsS "http://localhost:3002/api/v1/market-data/list?market=HK&instrument_type=Common%20Stock&page=1&page_size=50"
curl -fsS "http://localhost:3002/api/v1/market-data/movers?market=US&instrument_type=Common%20Stock&direction=gainers"
curl -fsS "http://localhost:3002/api/v1/market-data/movers?market=HK&instrument_type=ETF&direction=losers"
```

Verify:
- totals are larger
- list mode paginates correctly
- movers response still returns coverage
- no mock/synthetic quote rows appear

- [ ] **Step 4: Update README only if needed**

If the user-facing workflow meaningfully changes, add a short note to `README.md` describing:
- larger market universe support
- master-data import ownership
- movers coverage semantics

- [ ] **Step 5: Final verification**

Run:

```bash
cargo test --no-run
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
./scripts/deploy.sh status
curl -fsS http://localhost:3002/health
```

Expected: PASS or healthy status, with any known warnings explicitly noted.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document market universe expansion workflow"
```

---

## Notes

- Do not regress the “real data only” rule for movers snapshots.
- Do not silently mix unrelated instrument classes into this phase.
- If expansion materially increases quote failures in one market, report that honestly via coverage instead of hiding it.
- Prefer better operational visibility over cleverness. This phase is about making the market universe larger **and** easier to maintain.
