# Market Module Multi-Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the market module into three focused pages so `/market` becomes the leaderboard home, `/market/chart` becomes the dedicated stock chart page, and `/market/orderbook` becomes the dedicated order book page while preserving current US/HK market boards, movers filters, range filters, and symbol-level drill-down.

**Architecture:** Split the current mixed market page into shared market-module primitives plus three route-specific pages. Keep board and market filtering logic in focused helpers, extract route-aware module navigation into a reusable component, and move symbol-specific chart and order book presentation into dedicated pages that both support direct `?symbol=` entry and cross-page symbol-preserving navigation.

**Tech Stack:** Next.js App Router, React, TypeScript, existing `marketDataApi`, shared UI components, Vitest, Testing Library smoke tests.

---

## File Structure

- Create: `frontend/src/app/market/_components/MarketModuleNav.tsx`
  - Shared module-level secondary navigation for leaderboard, chart, and order book pages
  - Preserve current `symbol` in cross-page navigation when available
- Create: `frontend/src/app/market/_components/MarketEmptyState.tsx`
  - Shared empty state for chart/order book pages when `symbol` is missing
- Create: `frontend/src/app/market/chart/page.tsx`
  - Dedicated stock chart page using current chart/detail logic with `?symbol=`
- Create: `frontend/src/app/market/orderbook/page.tsx`
  - Dedicated order book page using current order book widget with `?symbol=`
- Modify: `frontend/src/app/market/page.tsx`
  - Reduce to leaderboard-focused page only
  - Add row actions to jump to chart/order book routes
- Modify: `frontend/src/app/market/market-page-helpers.ts`
  - Add focused helpers for market rows, route building, and symbol-preserving navigation if needed
- Modify: `frontend/src/lib/api.ts`
  - Extract or reuse symbol quote/history helpers cleanly across new chart and leaderboard pages
- Modify: `frontend/tests/ui-smoke.test.tsx`
  - Add route-level smoke coverage for leaderboard, chart, and order book pages
- Create or Modify: `frontend/tests/market-page-helpers.test.ts`
  - Cover any new navigation or route helper logic added during the split

### Task 1: Extract shared market-module navigation and empty-state primitives

**Files:**
- Create: `frontend/src/app/market/_components/MarketModuleNav.tsx`
- Create: `frontend/src/app/market/_components/MarketEmptyState.tsx`

- [ ] **Step 1: Write the failing component-level expectations**

Add assertions in `frontend/tests/ui-smoke.test.tsx` that expect:

```ts
it('shows shared market module navigation on market routes', async () => {
  renderWithQueryClient(React.createElement(MarketPage));

  expect(screen.getByRole('link', { name: '榜单' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '股票曲线' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '订单簿' })).toBeInTheDocument();
});
```

Add at least one route-preservation expectation if helpers are introduced:

```ts
expect(buildMarketModuleHref('/market/chart', 'AAPL')).toBe('/market/chart?symbol=AAPL');
```

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
cd frontend && npm run test:smoke
```

Expected: FAIL because shared nav does not exist yet.

- [ ] **Step 3: Implement reusable navigation and empty-state building blocks**

Create `frontend/src/app/market/_components/MarketModuleNav.tsx` with:
- A compact secondary nav for `榜单` / `股票曲线` / `订单簿`
- Current-route highlighting
- Optional `symbol` propagation so a selected symbol survives route switching

Create `frontend/src/app/market/_components/MarketEmptyState.tsx` with:
- Reusable title/body copy
- CTA back to `/market`
- Optional rendering of current `symbol`

If route helper extraction makes the implementation cleaner, add helper(s) in `frontend/src/app/market/market-page-helpers.ts`.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
cd frontend && npm run test:smoke
```

Expected: PASS for the new shared-nav expectations.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/market/_components/MarketModuleNav.tsx frontend/src/app/market/_components/MarketEmptyState.tsx frontend/src/app/market/market-page-helpers.ts frontend/tests/ui-smoke.test.tsx frontend/tests/market-page-helpers.test.ts
git commit -m "feat: add shared market module navigation"
```

### Task 2: Turn `/market` into a dedicated leaderboard page

**Files:**
- Modify: `frontend/src/app/market/page.tsx`
- Modify: `frontend/src/app/market/market-page-helpers.ts`

- [ ] **Step 1: Write the failing smoke expectations for leaderboard-only layout**

Extend `frontend/tests/ui-smoke.test.tsx` to assert that `/market`:
- Still renders `美股 / 港股`
- Still renders `全部 / 涨幅榜 / 跌幅榜`
- Still supports range filtering and search
- No longer renders the in-page chart or order book sections
- Renders row-level actions like `看曲线` and `看订单簿`

Example:

```ts
expect(screen.queryByText('订单簿')).not.toBeInTheDocument();
expect(screen.getAllByRole('link', { name: '看曲线' }).length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
cd frontend && npm run test:smoke
```

Expected: FAIL because the page still mixes leaderboard and symbol-detail regions.

- [ ] **Step 3: Refactor the page into a terminal-style leaderboard**

Update `frontend/src/app/market/page.tsx` so it:
- Starts with `MarketModuleNav`
- Focuses on board presentation only
- Keeps current market tabs, board mode toggles, search, and range filter behavior
- Removes embedded chart/order book content
- Makes stock name click-through default to `/market/chart?symbol=...`
- Adds explicit secondary action for `/market/orderbook?symbol=...`
- Tightens table/list alignment so symbol, name, last price, and change columns share a consistent visual grid

If needed, extend helpers for:
- Building chart/order book URLs
- Row formatting and numeric alignment metadata

- [ ] **Step 4: Run targeted verification**

Run:

```bash
cd frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/market/page.tsx frontend/src/app/market/market-page-helpers.ts frontend/tests/ui-smoke.test.tsx frontend/tests/market-page-helpers.test.ts
git commit -m "feat: make market page a dedicated leaderboard"
```

### Task 3: Create the dedicated stock chart page at `/market/chart`

**Files:**
- Create: `frontend/src/app/market/chart/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/tests/ui-smoke.test.tsx`

- [ ] **Step 1: Write the failing smoke expectations for direct chart routing**

Add smoke coverage that renders the chart page and verifies:
- The shared market nav is visible
- A `symbol` query drives the page content
- Missing `symbol` shows the shared empty state
- Switching from the nav preserves `symbol` when possible

Example:

```ts
renderWithQueryClient(React.createElement(MarketChartPage), {
  url: '/market/chart?symbol=AAPL',
});

expect(await screen.findByText('AAPL')).toBeInTheDocument();
expect(screen.getByRole('link', { name: '订单簿' })).toHaveAttribute('href', '/market/orderbook?symbol=AAPL');
```

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
cd frontend && npm run test:smoke
```

Expected: FAIL because the route does not exist yet.

- [ ] **Step 3: Implement the dedicated chart page**

Create `frontend/src/app/market/chart/page.tsx` that:
- Reads `symbol` from search params
- Renders `MarketModuleNav`
- Reuses existing quote/history/chart-fetch logic from the old market page
- Shows a focused single-symbol header with name, price, and change
- Provides a clean empty state when no `symbol` is supplied

Refactor `frontend/src/lib/api.ts` only if shared quote/history access becomes duplicated.

- [ ] **Step 4: Run targeted verification**

Run:

```bash
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/market/chart/page.tsx frontend/src/lib/api.ts frontend/tests/ui-smoke.test.tsx
git commit -m "feat: add dedicated market chart page"
```

### Task 4: Create the dedicated order book page at `/market/orderbook`

**Files:**
- Create: `frontend/src/app/market/orderbook/page.tsx`
- Modify: `frontend/tests/ui-smoke.test.tsx`

- [ ] **Step 1: Write the failing smoke expectations for the order book route**

Extend smoke coverage to verify:
- `/market/orderbook?symbol=...` renders the shared nav plus the selected symbol
- The page uses the reusable empty state when `symbol` is missing
- The nav can jump back to chart while preserving `symbol`

Example:

```ts
renderWithQueryClient(React.createElement(MarketOrderbookPage), {
  url: '/market/orderbook?symbol=0700.HK',
});

expect(await screen.findByText('0700.HK')).toBeInTheDocument();
expect(screen.getByRole('link', { name: '股票曲线' })).toHaveAttribute('href', '/market/chart?symbol=0700.HK');
```

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
cd frontend && npm run test:smoke
```

Expected: FAIL because the route does not exist yet.

- [ ] **Step 3: Implement the order book page**

Create `frontend/src/app/market/orderbook/page.tsx` that:
- Reads `symbol` from search params
- Renders `MarketModuleNav`
- Reuses the existing `MarketDataWidget` or equivalent order book content
- Shows a compact symbol summary above the order book
- Falls back to `MarketEmptyState` when no `symbol` is supplied

- [ ] **Step 4: Run targeted verification**

Run:

```bash
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/market/orderbook/page.tsx frontend/tests/ui-smoke.test.tsx
git commit -m "feat: add dedicated market orderbook page"
```

### Task 5: Final integration, regression sweep, and deployment readiness

**Files:**
- Review all touched frontend market-module files

- [ ] **Step 1: Run the full market regression set**

Run:

```bash
cd frontend && node --test --experimental-strip-types tests/market-page-helpers.test.ts
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```

Confirm:
- `/market` is leaderboard-first
- `/market/chart` supports direct symbol entry
- `/market/orderbook` supports direct symbol entry
- Shared nav preserves the current symbol where applicable
- No old embedded chart/order book blocks remain in `/market`

- [ ] **Step 2: Manual QA checklist**

Manually verify:
- Open `/market`
- Switch `美股 / 港股`
- Switch `全部 / 涨幅榜 / 跌幅榜`
- Apply and reset range filters
- Click `看曲线` and verify route becomes `/market/chart?symbol=...`
- From chart page, switch to `订单簿` and verify symbol remains
- Open `/market/orderbook` without `symbol` and verify the empty state appears

- [ ] **Step 3: Commit the finished slice**

```bash
git add frontend/src/app/market frontend/src/lib/api.ts frontend/tests/ui-smoke.test.tsx frontend/tests/market-page-helpers.test.ts
git commit -m "feat: split market module into focused pages"
```

- [ ] **Step 4: Deployment readiness**

After code review and approval, deploy with:

```bash
./scripts/deploy.sh refresh frontend
./scripts/deploy.sh status
curl -fsS http://localhost:3002/health
```

Expected:
- Frontend refresh succeeds
- Services stay healthy
- `/market`, `/market/chart`, and `/market/orderbook` are all reachable
