# Sprint A Task Checklist

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Break Sprint A into directly executable engineering tasks with files, actions, and acceptance checks.

**Architecture:** Use the existing Rust backend and Next.js frontend without introducing new services. Prefer contract hardening, tests, and docs over feature expansion.

**Tech Stack:** Rust, Axum, sqlx, Next.js 14, TypeScript, Docker Compose, GitHub Actions

---

## Issue 4: Clean Env Handling And Secret Loading

### Task 4.1
**Files**
- Modify: `.env.example`
- Modify: `src/config.rs`
- Modify: `README.md`

**Action**
- Enumerate all required env vars used by backend startup.
- Split them into required vs optional with sane defaults.
- Make missing required env vars fail with explicit messages.

**Done When**
- Backend startup error points to exact missing variable.
- `.env.example` can bootstrap local backend startup.

### Task 4.2
**Files**
- Modify: `src/broker/alpaca.rs`
- Modify: `src/config.rs`
- Modify: `README_RUST.md`

**Action**
- Verify Alpaca credentials only come from env/config.
- Remove any fallback values that could mask missing credentials.
- Document paper vs live config flags.

**Done When**
- No hardcoded broker secret or implicit production default remains.

### Task 4.3
**Files**
- Modify: `scripts/market_data.py`
- Modify: `.env.example`
- Modify: `README.md`

**Action**
- Audit Python market-data script env usage.
- Make upstream token/provider config explicit if used.
- Ensure mock fallback is opt-in or clearly marked in output.

**Done When**
- Script behavior is deterministic with and without provider config.

### Task 4.4
**Files**
- Modify: `scripts/deploy.sh`
- Modify: `docs/DEPLOYMENT_SOP.md`

**Action**
- Make deploy script validate required env/bootstrap state early.
- Surface port conflict and missing env problems clearly.

**Done When**
- Common startup failure modes are caught before compose startup.

## Issue 1: Stabilize Market-Data API Response Contract

### Task 1.1
**Files**
- Modify: `src/main.rs`
- Modify: `frontend/src/types/index.ts`

**Action**
- Define canonical quote/history response shape.
- Include metadata fields such as `source`, `fallback_used`, `is_stale`, `error`.

**Done When**
- Frontend and backend use the same response contract terms.

### Task 1.2
**Files**
- Modify: `src/main.rs`
- Modify: `src/data/mod.rs`
- Modify: `src/market_data/yahoo_finance.rs`

**Action**
- Make quote endpoint return structured degraded responses when upstream partially fails.
- Distinguish empty data, stale data, fallback data, and hard failure.

**Done When**
- API never returns ambiguous shapes for quote failures.

### Task 1.3
**Files**
- Modify: `src/main.rs`
- Modify: `scripts/market_data.py`

**Action**
- Align Python fallback output shape with Rust handler expectations.
- Preserve source attribution for mock or fallback data.

**Done When**
- Rust handler does not need ad-hoc parsing branches for fallback data.

### Task 1.4
**Files**
- Modify: `tests/api_test.rs`
- Modify: `tests/integration_test.rs`
- Modify: `src/main.rs`

**Action**
- Add tests for:
  - normal quote success
  - degraded fallback response
  - hard failure response

**Done When**
- Tests assert response shape and metadata, not only status code.

## Issue 3: Lock History Interval Normalization

### Task 3.1
**Files**
- Modify: `src/main.rs`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/market.ts`

**Action**
- Define one canonical interval map used by request builders and handlers.

**Done When**
- Same alias always resolves to the same canonical interval.

### Task 3.2
**Files**
- Modify: `frontend/src/app/market/page.tsx`

**Action**
- Restrict UI interval selector to supported values.
- Normalize outgoing params before request dispatch.

**Done When**
- UI cannot accidentally send unsupported ad-hoc interval strings.

### Task 3.3
**Files**
- Modify: `tests/api_test.rs`
- Modify: `tests/integration_test.rs`

**Action**
- Add table-driven tests for aliases:
  - `1m`
  - `1min`
  - `5m`
  - `15min`
  - `30min`
  - `1h`
  - `day`
  - `week`
  - `month`

**Done When**
- Alias coverage exists both at normalization and API contract level.

## Issue 2: Remove Silent Mock Masking In Frontend Widgets

### Task 2.1
**Files**
- Modify: `frontend/src/components/market/MarketDataWidget.tsx`
- Modify: `frontend/src/components/system/SystemStatus.tsx`
- Modify: `frontend/src/components/trading/RecentTrades.tsx`

**Action**
- Replace silent success-looking fallback with explicit degraded labels.
- Show whether data is live, fallback, stale, or unavailable.

**Done When**
- User can distinguish live system state from demo fallback state.

### Task 2.2
**Files**
- Modify: `frontend/src/lib/market.ts`
- Modify: `frontend/src/types/index.ts`

**Action**
- Add shared formatters for nullable price, pct, volume, timestamp.
- Remove unsafe `any` where practical in market-related payloads.

**Done When**
- Formatting logic is centralized and null-safe.

### Task 2.3
**Files**
- Modify: `frontend/src/app/market/page.tsx`
- Modify: `frontend/src/app/portfolio/page.tsx`
- Modify: `frontend/src/app/risk/page.tsx`
- Modify: `frontend/src/app/trading/page.tsx`

**Action**
- Add explicit UI states for loading, empty, degraded, and error.

**Done When**
- No page crashes or renders misleading zeroes for absent values.

### Task 2.4
**Files**
- Modify: `frontend/src/lib/api.ts`

**Action**
- Normalize frontend API error handling so components receive consistent typed errors or typed degraded payloads.

**Done When**
- Components no longer need ad-hoc `Array.isArray` and defensive casting in common paths.

## Issue 5: Rewrite Docs To Match Verified Runtime Behavior

### Task 5.1
**Files**
- Modify: `README.md`
- Modify: `README_PROJECT.md`

**Action**
- Rewrite project summary to separate:
  - implemented
  - partial
  - planned

**Done When**
- README claims match actual code and current sprint output.

### Task 5.2
**Files**
- Modify: `README_IMPLEMENTATION.md`
- Modify: `README_实现状态.md`

**Action**
- Remove outdated “completed” wording where implementation is still placeholder or partial.

**Done When**
- No misleading completion claims remain.

### Task 5.3
**Files**
- Modify: `docs/DEPLOYMENT_SOP.md`
- Modify: `README.md`

**Action**
- Re-verify all documented commands against actual `scripts/deploy.sh` behavior.
- Align API prefix, WebSocket path, default port, and health endpoint references.

**Done When**
- Docs can be followed verbatim for local startup.

## Issue 6: Add Baseline CI Workflow

### Task 6.1
**Files**
- Add: `.github/workflows/ci.yml`

**Action**
- Create CI workflow with separate backend and frontend jobs.

**Done When**
- PRs run backend and frontend checks automatically.

### Task 6.2
**Files**
- Modify: `Cargo.toml`
- Modify: `frontend/package.json`

**Action**
- Ensure CI commands are explicit and reproducible:
  - backend: `cargo test`
  - frontend: `npm run lint`, `npm run type-check`

**Done When**
- Same commands work locally and in CI.

### Task 6.3
**Files**
- Modify: `docs/DEPLOYMENT_SOP.md`
- Modify: `.github/workflows/ci.yml`

**Action**
- Decide whether compose smoke test fits Sprint A.
- If yes, add a minimal health-check smoke step.
- If no, document it as Sprint B follow-up.

**Done When**
- CI scope is explicit, not implied.

## Verification Commands

### Backend
```bash
cargo test
```

### Frontend
```bash
cd frontend
npm run lint
npm run type-check
```

### Docs And Deploy
```bash
./scripts/deploy.sh status
./scripts/deploy.sh up --build
curl http://localhost:3002/health
```

## Recommended Delivery Sequence

1. Issue 4
2. Issue 1
3. Issue 3
4. Issue 2
5. Issue 5
6. Issue 6

## Manager View

- Week 1 target: Issues 4, 1, 3
- Week 2 target: Issues 2, 5, 6
- Must-have sprint demo: degraded market-data path, verified docs, passing CI
