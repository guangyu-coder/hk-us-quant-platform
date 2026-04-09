# Market Universe And Range Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the market page to use much larger built-in US/HK symbol universes and support generic daily change-percent range filtering alongside the existing board modes.

**Architecture:** Keep the current `market=US|HK` API shape, but enlarge the static symbol universe returned by the backend and keep sorting/filtering on the frontend. Add focused market helper functions for change-percent range validation and filtering, then wire those helpers into the market page with a small filter bar and smoke coverage.

**Tech Stack:** Rust/Axum backend, Next.js/React frontend, TypeScript helpers, Vitest smoke/helper tests.

---

### Task 1: Expand Built-In US And HK Market Universes

**Files:**
- Modify: `/Users/liguangyu/githubProj/hk-us-quant-platform/src/main.rs`
- Test: `/Users/liguangyu/githubProj/hk-us-quant-platform/src/main.rs`

- [ ] **Step 1: Write the failing backend test**

Add tests near the existing market list tests in `/Users/liguangyu/githubProj/hk-us-quant-platform/src/main.rs`:

```rust
#[test]
fn market_symbol_list_expands_us_universe() {
    let us_symbols = built_in_market_symbols(Some("US"));

    assert!(us_symbols.len() >= 25, "expected a much larger US universe");
    assert!(us_symbols.iter().any(|item| item.symbol == "AAPL"));
    assert!(us_symbols.iter().any(|item| item.symbol == "NVDA"));
    assert!(us_symbols.iter().any(|item| item.symbol == "META"));
    assert!(us_symbols.iter().all(|item| !item.symbol.ends_with(".HK")));
}

#[test]
fn market_symbol_list_expands_hk_universe() {
    let hk_symbols = built_in_market_symbols(Some("HK"));

    assert!(hk_symbols.len() >= 15, "expected a much larger HK universe");
    assert!(hk_symbols.iter().any(|item| item.symbol == "0700.HK"));
    assert!(hk_symbols.iter().any(|item| item.symbol == "9988.HK"));
    assert!(hk_symbols.iter().all(|item| item.symbol.ends_with(".HK")));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cargo test market_symbol_list_expands_us_universe market_symbol_list_expands_hk_universe -- --nocapture
```

Expected:

- FAIL because the current built-in lists are still too small

- [ ] **Step 3: Write the minimal backend implementation**

Update the built-in list function in `/Users/liguangyu/githubProj/hk-us-quant-platform/src/main.rs` so the static fallback lists are substantially larger.

Use this shape for the additions:

```rust
SearchResult {
    symbol: "META".to_string(),
    instrument_name: "Meta Platforms, Inc.".to_string(),
    exchange: "NASDAQ".to_string(),
    country: "United States".to_string(),
    instrument_type: "Common Stock".to_string(),
    aliases: vec!["Meta".to_string(), "Facebook".to_string()],
}
```

Add a larger US set covering at least:

```text
AAPL AMZN GOOGL MSFT NVDA TSLA META NFLX AMD INTC CRM ORCL ADBE QCOM AVGO
JPM BAC WFC GS V MA MAKO? (skip invalid ticker) KO PEP MCD DIS NKE COST WMT
SPY QQQ DIA IWM
```

Use only valid tickers. Do not include placeholders or guessed symbols.

Add a larger HK set covering at least:

```text
0001.HK 0005.HK 0011.HK 0388.HK 0700.HK 0939.HK 0941.HK 1299.HK
1398.HK 2318.HK 2388.HK 2628.HK 3690.HK 3988.HK 9988.HK
```

Keep the existing field names and market classification behavior unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cargo test market_symbol_list_expands_us_universe market_symbol_list_expands_hk_universe -- --nocapture
```

Expected:

- PASS

- [ ] **Step 5: Run the broader market list backend checks**

Run:

```bash
cargo test market_symbol_ -- --nocapture
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add /Users/liguangyu/githubProj/hk-us-quant-platform/src/main.rs
git commit -m "feat: expand built-in market symbol universes"
```

### Task 2: Add Range Filter Helpers With TDD

**Files:**
- Modify: `/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/market/market-page-helpers.ts`
- Modify: `/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/tests/market-page-helpers.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Add tests to `/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/tests/market-page-helpers.test.ts`:

```ts
test('filters stocks by minimum and maximum daily change percent', () => {
  const stocks = [
    { symbol: 'AAPL', changePercent: 6.2 },
    { symbol: 'TSLA', changePercent: -4.5 },
    { symbol: 'MSFT', changePercent: 1.1 },
  ];

  const filtered = filterStocksByChangePercentRange(stocks, { min: -1, max: 5 });

  assert.deepEqual(
    filtered.map((item) => item.symbol),
    ['MSFT']
  );
});

test('accepts open-ended change percent ranges', () => {
  const stocks = [
    { symbol: 'AAPL', changePercent: 6.2 },
    { symbol: 'TSLA', changePercent: -4.5 },
    { symbol: 'MSFT', changePercent: 1.1 },
  ];

  assert.deepEqual(
    filterStocksByChangePercentRange(stocks, { min: 5 }).map((item) => item.symbol),
    ['AAPL']
  );
  assert.deepEqual(
    filterStocksByChangePercentRange(stocks, { max: -3 }).map((item) => item.symbol),
    ['TSLA']
  );
});

test('detects invalid change percent ranges', () => {
  assert.equal(
    getChangePercentRangeError({ min: 5, max: -1 }),
    '最小涨跌幅不能大于最大涨跌幅'
  );
  assert.equal(getChangePercentRangeError({ min: -3, max: 5 }), null);
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
cd /Users/liguangyu/githubProj/hk-us-quant-platform/frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts
```

Expected:

- FAIL because the new helper exports do not exist yet

- [ ] **Step 3: Write the minimal helper implementation**

Extend `/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/market/market-page-helpers.ts` with:

```ts
export type ChangePercentRange = {
  min?: number | null;
  max?: number | null;
};

export const getChangePercentRangeError = (range: ChangePercentRange): string | null => {
  if (
    typeof range.min === 'number' &&
    typeof range.max === 'number' &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max) &&
    range.min > range.max
  ) {
    return '最小涨跌幅不能大于最大涨跌幅';
  }

  return null;
};

export const filterStocksByChangePercentRange = <T extends StockLike>(
  items: T[],
  range: ChangePercentRange
): T[] => {
  if (getChangePercentRangeError(range)) {
    return items;
  }

  return items.filter((item) => {
    if (!Number.isFinite(item.changePercent)) {
      return false;
    }

    const value = item.changePercent ?? 0;

    if (typeof range.min === 'number' && Number.isFinite(range.min) && value < range.min) {
      return false;
    }

    if (typeof range.max === 'number' && Number.isFinite(range.max) && value > range.max) {
      return false;
    }

    return true;
  });
};
```

Keep `sortStocksByBoardMode` unchanged except for any required type export updates.

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
cd /Users/liguangyu/githubProj/hk-us-quant-platform/frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/market/market-page-helpers.ts /Users/liguangyu/githubProj/hk-us-quant-platform/frontend/tests/market-page-helpers.test.ts
git commit -m "test: add market change range helper coverage"
```

### Task 3: Wire Range Filters Into The Market Page

**Files:**
- Modify: `/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/market/page.tsx`

- [ ] **Step 1: Write the failing market smoke expectations**

Extend the existing market smoke in `/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/tests/ui-smoke.test.tsx` with assertions like:

```ts
await user.type(screen.getByLabelText('最小涨跌幅'), '5');
await waitFor(() => {
  const cards = screen.getAllByRole('button', { name: /选择股票/ });
  expect(cards[0]?.textContent ?? '').toContain('0700.HK');
  expect(screen.queryByText('China Mobile')).toBeNull();
});

await user.clear(screen.getByLabelText('最小涨跌幅'));
await user.type(screen.getByLabelText('最大涨跌幅'), '-3');
await waitFor(() => {
  const cards = screen.getAllByRole('button', { name: /选择股票/ });
  expect(cards[0]?.textContent ?? '').toContain('0941.HK');
});

await user.clear(screen.getByLabelText('最大涨跌幅'));
await user.type(screen.getByLabelText('最小涨跌幅'), '5');
await user.type(screen.getByLabelText('最大涨跌幅'), '1');
expect(await screen.findByText('最小涨跌幅不能大于最大涨跌幅')).toBeTruthy();
```

- [ ] **Step 2: Run the focused smoke to verify it fails**

Run:

```bash
cd /Users/liguangyu/githubProj/hk-us-quant-platform/frontend && npx vitest run tests/ui-smoke.test.tsx -t "switches market tabs, board modes, and current-market search on the market page" --reporter=verbose
```

Expected:

- FAIL because the page does not yet render range inputs or validation

- [ ] **Step 3: Write the minimal page implementation**

Update `/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/market/page.tsx` to:

1. Add local state:

```ts
const [minChangePercentInput, setMinChangePercentInput] = useState('');
const [maxChangePercentInput, setMaxChangePercentInput] = useState('');
```

2. Parse inputs:

```ts
const parseOptionalNumber = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const changePercentRange = {
  min: parseOptionalNumber(minChangePercentInput),
  max: parseOptionalNumber(maxChangePercentInput),
};
const changePercentRangeError = getChangePercentRangeError(changePercentRange);
```

3. Compose the displayed list:

```ts
const displayedStocks = filterStocksByChangePercentRange(
  sortStocksByBoardMode(marketStocks, selectedBoardMode),
  changePercentRange
);
```

4. Add the filter UI above the stock list:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
  <label className="text-xs text-muted-foreground">
    最小涨跌幅
    <input
      aria-label="最小涨跌幅"
      type="number"
      value={minChangePercentInput}
      onChange={(e) => setMinChangePercentInput(e.target.value)}
      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      placeholder="例如 5"
    />
  </label>
  <label className="text-xs text-muted-foreground">
    最大涨跌幅
    <input
      aria-label="最大涨跌幅"
      type="number"
      value={maxChangePercentInput}
      onChange={(e) => setMaxChangePercentInput(e.target.value)}
      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      placeholder="例如 -5"
    />
  </label>
</div>
<button
  type="button"
  onClick={() => {
    setMinChangePercentInput('');
    setMaxChangePercentInput('');
  }}
  className="text-xs text-muted-foreground hover:text-foreground mb-4"
>
  重置筛选
</button>
```

5. Render the validation/error state:

```tsx
{changePercentRangeError && (
  <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
    {changePercentRangeError}
  </div>
)}
```

6. Change the empty-state copy to distinguish empty market from empty filter:

```tsx
{marketStocks.length === 0 ? '当前市场暂无可展示股票' : '当前筛选下暂无股票'}
```

- [ ] **Step 4: Run the focused smoke to verify it passes**

Run:

```bash
cd /Users/liguangyu/githubProj/hk-us-quant-platform/frontend && npx vitest run tests/ui-smoke.test.tsx -t "switches market tabs, board modes, and current-market search on the market page" --reporter=verbose
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/market/page.tsx /Users/liguangyu/githubProj/hk-us-quant-platform/frontend/tests/ui-smoke.test.tsx
git commit -m "feat: add market change percent range filters"
```

### Task 4: Run Full Verification And Ship-Readiness Checks

**Files:**
- Modify: `/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/tests/ui-smoke.test.tsx`
- Verify: `/Users/liguangyu/githubProj/hk-us-quant-platform/src/main.rs`
- Verify: `/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/market/page.tsx`

- [ ] **Step 1: Run frontend helper and smoke suites**

Run:

```bash
cd /Users/liguangyu/githubProj/hk-us-quant-platform/frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts
cd /Users/liguangyu/githubProj/hk-us-quant-platform/frontend && npm run test:smoke
```

Expected:

- PASS

- [ ] **Step 2: Run frontend static verification**

Run:

```bash
cd /Users/liguangyu/githubProj/hk-us-quant-platform/frontend && npm run type-check
cd /Users/liguangyu/githubProj/hk-us-quant-platform/frontend && npm run lint
```

Expected:

- PASS

- [ ] **Step 3: Run backend verification**

Run:

```bash
cargo test market_symbol_ -- --nocapture
cargo test --no-run
```

Expected:

- PASS

- [ ] **Step 4: Review spec coverage before final commit**

Check that the implementation covers:

- larger US/HK built-in universes
- board modes still work
- min/max change percent range filters
- invalid range message
- reset filter
- market search still scoped to the selected tab

If anything is missing, add it before the final commit.

- [ ] **Step 5: Commit any last verification-driven fixups**

```bash
git add /Users/liguangyu/githubProj/hk-us-quant-platform/src/main.rs /Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/market/market-page-helpers.ts /Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/market/page.tsx /Users/liguangyu/githubProj/hk-us-quant-platform/frontend/tests/market-page-helpers.test.ts /Users/liguangyu/githubProj/hk-us-quant-platform/frontend/tests/ui-smoke.test.tsx
git commit -m "test: verify market universe and range filters"
```

## Self-Review

Spec coverage:

- Larger built-in US/HK directories: Task 1
- Generic min/max change percent range filtering: Tasks 2 and 3
- Invalid range handling and reset behavior: Task 3
- Smoke, helper, and backend verification: Task 4

Placeholder scan:

- No `TODO`, `TBD`, or unresolved placeholders remain

Type consistency:

- `MarketTab` and `BoardMode` remain unchanged
- New helper names are consistent across tests and page wiring:
  - `ChangePercentRange`
  - `getChangePercentRangeError`
  - `filterStocksByChangePercentRange`

Execution handoff:

Plan complete and saved to `/Users/liguangyu/githubProj/hk-us-quant-platform/docs/superpowers/plans/2026-04-09-market-universe-and-range-filter.md`.
