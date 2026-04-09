# Market Tabs And Movers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the market page so users can switch between US and HK markets, browse all symbols or same-day gainers/losers, and search within the currently selected market while keeping the existing single-symbol detail experience.

**Architecture:** Extend the existing market list API with a market filter and reuse current batch quote endpoints to build ranked market boards on the frontend. Keep the page in the existing route, but extract market classification and sorting logic into focused helpers so the tabbed market list and the single-symbol detail area stay decoupled.

**Tech Stack:** Next.js App Router, React, TypeScript, React hooks, existing `marketDataApi`, Rust Axum backend, existing market data Python integration, Vitest, cargo test.

---

## File Structure

- Modify: `src/main.rs`
  - Add `market` query parsing for `/api/v1/market-data/list`
  - Centralize market classification helper used by list filtering
  - Add or update backend tests for market parameter parsing and classification
- Modify: `frontend/src/app/market/page.tsx`
  - Replace mixed stock list logic with market tabs and board mode state
  - Integrate current-market search filtering and movers ranking
  - Keep current selected-symbol chart/detail flow intact
- Create: `frontend/src/app/market/market-page-helpers.ts`
  - Hold market classification, board sorting, and search filtering helpers for the page
- Create: `frontend/tests/market-page-helpers.test.ts`
  - Cover helper logic for market split, gainers/losers ordering, and search filtering
- Modify: `frontend/tests/ui-smoke.test.tsx`
  - Add a market page smoke flow for tab switching, movers mode switching, and current-market search behavior

### Task 1: Add backend market filter support to market symbol listing

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: Write the failing backend tests for market classification and list filtering**

Add tests near the existing market-data response tests in `src/main.rs`:

```rust
    #[test]
    fn market_symbol_filter_recognizes_hk_and_us_symbols() {
        assert_eq!(infer_market_from_symbol_record("0700.HK", Some("HKEX"), Some("Hong Kong")), "HK");
        assert_eq!(infer_market_from_symbol_record("AAPL", Some("NASDAQ"), Some("United States")), "US");
        assert_eq!(infer_market_from_symbol_record("0005", Some("Hong Kong"), Some("Hong Kong")), "HK");
    }

    #[test]
    fn market_symbol_filter_defaults_unknown_symbols_to_us() {
        assert_eq!(infer_market_from_symbol_record("TSLA", None, None), "US");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test market_symbol_filter_ -- --nocapture`

Expected: FAIL because `infer_market_from_symbol_record` does not exist yet.

- [ ] **Step 3: Implement minimal market classification helper and query parsing**

Add a focused helper in `src/main.rs` close to the current market symbol normalization helpers:

```rust
fn infer_market_from_symbol_record(
    symbol: &str,
    exchange: Option<&str>,
    country: Option<&str>,
) -> &'static str {
    let symbol = symbol.trim().to_uppercase();
    let exchange = exchange.unwrap_or_default().trim().to_uppercase();
    let country = country.unwrap_or_default().trim().to_uppercase();

    let is_hk = symbol.ends_with(".HK")
        || exchange.contains("HK")
        || exchange.contains("HONG KONG")
        || exchange.contains("HKEX")
        || country.contains("HONG KONG");

    if is_hk { "HK" } else { "US" }
}
```

Then update the `/api/v1/market-data/list` handler query parsing to accept `market`, and filter the parsed list before returning it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test market_symbol_filter_ -- --nocapture`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main.rs
git commit -m "feat: support market-filtered symbol lists"
```

### Task 2: Add frontend helper coverage for market tabs and movers sorting

**Files:**
- Create: `frontend/src/app/market/market-page-helpers.ts`
- Create: `frontend/tests/market-page-helpers.test.ts`

- [ ] **Step 1: Write the failing frontend helper tests**

Create `frontend/tests/market-page-helpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  filterSearchResultsByMarket,
  inferMarketFromSearchResult,
  sortStocksByBoardMode,
} from '../src/app/market/market-page-helpers';

describe('market-page helpers', () => {
  it('classifies hk symbols from suffix and exchange fields', () => {
    expect(inferMarketFromSearchResult({ symbol: '0700.HK', exchange: 'HKEX', country: 'Hong Kong' })).toBe('HK');
    expect(inferMarketFromSearchResult({ symbol: 'AAPL', exchange: 'NASDAQ', country: 'United States' })).toBe('US');
  });

  it('sorts gainers and losers by same-day change percent', () => {
    const stocks = [
      { symbol: 'A', changePercent: -3.2 },
      { symbol: 'B', changePercent: 5.4 },
      { symbol: 'C', changePercent: 1.1 },
    ];

    expect(sortStocksByBoardMode(stocks, 'gainers').map((item) => item.symbol)).toEqual(['B', 'C', 'A']);
    expect(sortStocksByBoardMode(stocks, 'losers').map((item) => item.symbol)).toEqual(['A', 'C', 'B']);
  });

  it('filters search results by selected market', () => {
    const results = [
      { symbol: 'AAPL', exchange: 'NASDAQ', country: 'United States' },
      { symbol: '0700.HK', exchange: 'HKEX', country: 'Hong Kong' },
    ];

    expect(filterSearchResultsByMarket(results, 'US')).toHaveLength(1);
    expect(filterSearchResultsByMarket(results, 'HK')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts`

Expected: FAIL because helper file does not exist yet.

- [ ] **Step 3: Write minimal helper implementation**

Create `frontend/src/app/market/market-page-helpers.ts`:

```ts
export type MarketTab = 'US' | 'HK';
export type BoardMode = 'all' | 'gainers' | 'losers';

type SearchLike = { symbol?: string; exchange?: string; country?: string };
type StockLike = { changePercent?: number | null };

export const inferMarketFromSearchResult = (item: SearchLike): MarketTab => {
  const symbol = item.symbol?.trim().toUpperCase() ?? '';
  const exchange = item.exchange?.trim().toUpperCase() ?? '';
  const country = item.country?.trim().toUpperCase() ?? '';
  const isHongKong =
    symbol.endsWith('.HK') ||
    exchange.includes('HK') ||
    exchange.includes('HKEX') ||
    exchange.includes('HONG KONG') ||
    country.includes('HONG KONG');

  return isHongKong ? 'HK' : 'US';
};

export const filterSearchResultsByMarket = <T extends SearchLike>(items: T[], market: MarketTab): T[] =>
  items.filter((item) => inferMarketFromSearchResult(item) === market);

export const sortStocksByBoardMode = <T extends StockLike>(items: T[], mode: BoardMode): T[] => {
  if (mode === 'all') return items;

  return [...items]
    .filter((item) => Number.isFinite(item.changePercent))
    .sort((left, right) =>
      mode === 'gainers'
        ? (right.changePercent ?? Number.NEGATIVE_INFINITY) - (left.changePercent ?? Number.NEGATIVE_INFINITY)
        : (left.changePercent ?? Number.POSITIVE_INFINITY) - (right.changePercent ?? Number.POSITIVE_INFINITY)
    );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/market/market-page-helpers.ts frontend/tests/market-page-helpers.test.ts
git commit -m "test: add market page helper coverage"
```

### Task 3: Rework the market page into market tabs plus board modes

**Files:**
- Modify: `frontend/src/app/market/page.tsx`
- Modify: `frontend/src/app/market/market-page-helpers.ts`

- [ ] **Step 1: Write the failing smoke expectations for the market page**

Extend `frontend/tests/ui-smoke.test.tsx` with a market-page test:

```ts
  it('switches market tabs and movers modes on the market page', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(React.createElement(MarketPage));

    await screen.findByRole('tab', { name: '美股' });
    await screen.findByRole('tab', { name: '港股' });
    await screen.findByRole('button', { name: '涨幅榜' });

    await user.click(screen.getByRole('tab', { name: '港股' }));
    await user.click(screen.getByRole('button', { name: '跌幅榜' }));

    expect(await screen.findByText('港股市场')).toBeTruthy();
  });
```

Also add minimal mocks for market list, batch quote, and search results in the test setup.

- [ ] **Step 2: Run smoke test to verify it fails**

Run: `cd frontend && npm run test:smoke`

Expected: FAIL because the market page does not yet render tabs or board mode controls.

- [ ] **Step 3: Implement market tab state and ranked stock list UI**

Update `frontend/src/app/market/page.tsx` with:

- `selectedMarket` state defaulting to `'US'`
- `selectedBoardMode` state defaulting to `'all'`
- market-scoped stock list loading using `/market-data/list?market=...`
- batch quote hydration for the currently visible market
- sorted display using `sortStocksByBoardMode`
- a tab/button control section rendered above the stock list

The core state shape should look like:

```ts
const [selectedMarket, setSelectedMarket] = useState<MarketTab>('US');
const [selectedBoardMode, setSelectedBoardMode] = useState<BoardMode>('all');
const [marketStocks, setMarketStocks] = useState<StockData[]>([]);
```

Use the helper file for market and sorting logic rather than embedding it all in the component.

- [ ] **Step 4: Run smoke test to verify the new UI passes**

Run: `cd frontend && npm run test:smoke`

Expected: PASS for the new market-page smoke plus the existing smoke flows.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/market/page.tsx frontend/tests/ui-smoke.test.tsx frontend/src/app/market/market-page-helpers.ts
git commit -m "feat: add market tabs and movers boards"
```

### Task 4: Scope symbol search to the active market and preserve detail loading

**Files:**
- Modify: `frontend/src/app/market/page.tsx`
- Modify: `frontend/src/app/market/market-page-helpers.ts`
- Modify: `frontend/tests/ui-smoke.test.tsx`

- [ ] **Step 1: Write the failing smoke assertion for market-scoped search**

Extend the market smoke test with:

```ts
    await user.type(screen.getByPlaceholderText('搜索股票代码或名称...'), '700');
    expect(await screen.findByText('Tencent Holdings')).toBeTruthy();
    expect(screen.queryByText('Apple Inc.')).toBeNull();
```

Then switch back to US and assert the inverse with `AAPL`.

- [ ] **Step 2: Run smoke test to verify it fails**

Run: `cd frontend && npm run test:smoke`

Expected: FAIL because search results are not yet scoped to the active market.

- [ ] **Step 3: Implement current-market search filtering and selection syncing**

Update the search effect in `frontend/src/app/market/page.tsx` to:

- fetch search results through `marketDataApi.searchSymbols`
- filter them with `filterSearchResultsByMarket(results, selectedMarket)`
- update `selectedSymbol` with the normalized symbol from the chosen result

Keep current chart/detail loading triggered by `selectedSymbol` so the selected market list and the detail widget stay synchronized.

- [ ] **Step 4: Run smoke test to verify it passes**

Run: `cd frontend && npm run test:smoke`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/market/page.tsx frontend/src/app/market/market-page-helpers.ts frontend/tests/ui-smoke.test.tsx
git commit -m "feat: filter market search by active tab"
```

### Task 5: Run full verification and clean up copy and empty states

**Files:**
- Modify: `frontend/src/app/market/page.tsx`
- Modify: `frontend/tests/ui-smoke.test.tsx`
- Modify: `frontend/tests/market-page-helpers.test.ts`

- [ ] **Step 1: Add the last missing empty-state and degraded-state assertions**

Add targeted assertions for:

- no current-market stocks
- no current-market search results
- board mode with missing `changePercent`

Prefer helper-level coverage for ordering edge cases and one smoke assertion for the empty-state copy.

- [ ] **Step 2: Run the helper test suite**

Run: `cd frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts`

Expected: PASS

- [ ] **Step 3: Run full frontend verification**

Run:

```bash
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```

Expected:

- `type-check`: PASS
- `lint`: PASS
- `test:smoke`: PASS

- [ ] **Step 4: Run the focused backend verification**

Run:

```bash
cargo test market_symbol_filter_ -- --nocapture
cargo test --no-run
```

Expected:

- market filter tests PASS
- compile-only backend test suite PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/market/page.tsx frontend/tests/ui-smoke.test.tsx frontend/tests/market-page-helpers.test.ts src/main.rs
git commit -m "test: verify market tabs and movers flow"
```

## Self-Review

### Spec coverage

- Market tab split: Task 3
- All / gainers / losers modes: Task 2 + Task 3
- Search scoped to active market: Task 4
- Market-filtered symbol list API: Task 1
- Preserve single-symbol chart/detail experience: Task 3 + Task 4
- Testing requirements: Tasks 1, 2, 3, 4, 5

No uncovered spec requirement remains.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to” placeholders remain
- Each coding task lists exact files and exact commands
- Each test-first step contains concrete test content

### Type consistency

- Backend market values use `US | HK`
- Frontend tab type uses `MarketTab = 'US' | 'HK'`
- Board mode uses `all | gainers | losers` consistently across helper and page tasks

