# Sprint A Backlog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** In two weeks, make the current platform stable enough for repeatable demos and daily development by hardening market-data behavior, config handling, docs, and baseline CI.

**Architecture:** Keep all work inside the existing Rust backend + Next.js frontend modular monolith. Focus on contract tightening and testability, not feature expansion. Use Mock/fallback paths deliberately, but make degraded behavior explicit and observable.

**Tech Stack:** Rust, Axum, sqlx, Redis, Next.js 14, React, TypeScript, Docker Compose, GitHub Actions

---

## Sprint Goal

By the end of Sprint A:
- Market-data related pages and APIs degrade gracefully under upstream failures.
- Config and secret handling are environment-driven and documented.
- README/deployment docs match actual system behavior.
- CI blocks obvious backend/frontend regressions.

## Sprint Scope

Included:
- Market-data error contract and frontend guardrails
- History interval normalization consistency
- Secret/config cleanup
- Docs/runtime alignment
- Baseline CI quality gates

Excluded:
- Real backtest engine
- Broker reconciliation
- Auth system
- Full trading-core refactor

## Priority Backlog

### P0-1: Unified Market Data Failure Contract

**Problem**
- Backend market data comes from mixed sources and can fail in different shapes.
- Frontend currently falls back to mock display in some components, which hides real failure modes.

**Target Files**
- `src/main.rs`
- `src/data/mod.rs`
- `src/market_data/yahoo_finance.rs`
- `scripts/market_data.py`
- `frontend/src/lib/api.ts`
- `frontend/src/components/market/MarketDataWidget.tsx`
- `frontend/src/app/market/page.tsx`

**Deliverable**
- One response contract for quote/history endpoints:
  - success
  - degraded upstream fallback
  - explicit upstream failure
- Frontend shows stale/degraded/error state instead of silently pretending all data is live.

**Acceptance Criteria**
- `/api/v1/market-data/:symbol` and history endpoints always return a predictable shape.
- Response includes source/fallback metadata when degraded.
- Frontend can render success, empty, stale, and error states without crashing.
- Add tests for at least one degraded and one hard-failure path.

### P0-2: Frontend Numeric Guardrails

**Problem**
- Current market/trading widgets assume numeric fields are always present and valid.
- This is fragile under partial upstream data or changed API payloads.

**Target Files**
- `frontend/src/components/market/MarketDataWidget.tsx`
- `frontend/src/components/trading/RecentTrades.tsx`
- `frontend/src/app/portfolio/page.tsx`
- `frontend/src/app/risk/page.tsx`
- `frontend/src/types/index.ts`
- `frontend/src/lib/market.ts`

**Deliverable**
- Shared formatting/guard helpers for nullable numbers, percentages, and timestamps.

**Acceptance Criteria**
- No component throws when price, change, volume, pnl, or risk metrics are null/undefined.
- Mock fallback is clearly labeled if retained.
- TypeScript types reflect optionality instead of masking it with `any`.

### P0-3: Normalize History Interval End-To-End

**Problem**
- Interval normalization exists in backend, but end-to-end behavior is not fully locked down across API and UI.

**Target Files**
- `src/main.rs`
- `frontend/src/lib/api.ts`
- `frontend/src/app/market/page.tsx`
- `tests/api_test.rs`
- `tests/integration_test.rs`

**Deliverable**
- Canonical interval mapping table shared by API contract and UI controls.

**Acceptance Criteria**
- Supported aliases map deterministically to canonical values.
- Unsupported intervals fail predictably or normalize predictably, by explicit rule.
- Tests cover canonical cases: `1m`, `5m`, `15m`, `30m`, `1h`, `1d`, `1wk`, `1mo`.

### P0-4: Secret And Config Hygiene

**Problem**
- Existing docs/backlog already indicate config drift and hardcoded-secret risk.
- This is a blocker for reliable deployment and future broker integrations.

**Target Files**
- `.env.example`
- `README.md`
- `README_PROJECT.md`
- `README_RUST.md`
- `scripts/deploy.sh`
- `src/config.rs`
- `src/broker/alpaca.rs`
- `scripts/market_data.py`

**Deliverable**
- Single documented env-source-of-truth for backend, frontend, broker, and data-provider settings.

**Acceptance Criteria**
- No tracked file contains real credentials.
- Startup failure messages clearly indicate missing required env vars.
- `.env.example` is sufficient for local bootstrap.
- README only documents supported env vars and verified commands.

### P1-1: Docs And Runtime Alignment

**Problem**
- README claims and actual implementation have drifted before.

**Target Files**
- `README.md`
- `README_PROJECT.md`
- `README_IMPLEMENTATION.md`
- `README_实现状态.md`
- `docs/DEPLOYMENT_SOP.md`

**Deliverable**
- One coherent source of truth:
  - what is implemented
  - what is placeholder
  - how to run locally
  - which entrypoints are supported

**Acceptance Criteria**
- Docs distinguish implemented, partial, and planned behavior.
- All commands in docs have been re-run during the sprint.
- WebSocket path, API prefix, and deployment port are consistent across docs.

### P1-2: Baseline CI Quality Gates

**Problem**
- Current local tests pass, but merge protection is weak without automation.

**Target Files**
- `.github/workflows/ci.yml`
- `Cargo.toml`
- `frontend/package.json`
- `docs/DEPLOYMENT_SOP.md`

**Deliverable**
- Minimal CI pipeline for backend and frontend regression checks.

**Acceptance Criteria**
- CI runs `cargo test`.
- CI runs frontend type-check and lint.
- CI either runs a compose smoke test or documents it as a follow-up if infra time exceeds sprint capacity.

## Issue Breakdown

### Issue 1
**Title:** Stabilize market-data API response contract
**Priority:** P0
**Estimate:** 2-3 days
**Depends On:** none

**Subtasks**
- Audit current quote/history response shapes in Rust and Python paths.
- Define response metadata fields for `source`, `is_stale`, `fallback_used`, `error`.
- Refactor handlers to always return the same shape.
- Add backend tests for degraded/failure cases.

### Issue 2
**Title:** Remove silent mock masking in frontend market/trading widgets
**Priority:** P0
**Estimate:** 1-2 days
**Depends On:** Issue 1

**Subtasks**
- Replace implicit fake-success display with explicit degraded UI labels.
- Centralize formatting for nullable values.
- Add loading, empty, stale, and error variants on market pages.

### Issue 3
**Title:** Lock history interval normalization across UI and backend
**Priority:** P0
**Estimate:** 0.5-1 day
**Depends On:** none

**Subtasks**
- Define canonical interval enum/table.
- Reuse it from UI requests and backend validation.
- Add tests for alias mapping.

### Issue 4
**Title:** Clean env handling and secret loading
**Priority:** P0
**Estimate:** 1-2 days
**Depends On:** none

**Subtasks**
- Audit env vars used by Rust, Python, and Next.js.
- Remove any hardcoded values or ambiguous defaults.
- Improve startup/config validation errors.
- Refresh `.env.example`.

### Issue 5
**Title:** Rewrite docs to match verified runtime behavior
**Priority:** P1
**Estimate:** 1 day
**Depends On:** Issues 1, 3, 4

**Subtasks**
- Mark placeholder areas clearly.
- Collapse duplicated/conflicting readmes where possible.
- Re-verify commands after edits.

### Issue 6
**Title:** Add baseline CI workflow
**Priority:** P1
**Estimate:** 1 day
**Depends On:** Issues 1, 2, 3

**Subtasks**
- Add backend test job.
- Add frontend lint/type-check job.
- Optionally add compose smoke test if stable within sprint.

## Suggested Execution Order

1. Issue 4: env/config cleanup
2. Issue 1: market-data API contract
3. Issue 3: interval normalization
4. Issue 2: frontend guardrails and degraded UI
5. Issue 5: docs alignment
6. Issue 6: CI gates

## Sprint Risks

- Existing dirty working tree may mix unrelated changes into sprint commits.
- Frontend currently uses some mock fallback patterns that may conceal API contract problems.
- Compose-based smoke tests may be noisy if port and startup timing are not stabilized first.

## Sprint Demo Checklist

- Open dashboard, market, portfolio, risk, strategies, and trading pages with backend running.
- Simulate upstream market data failure and show degraded UI instead of crash.
- Show `.env.example` and startup docs that match actual boot flow.
- Show CI workflow passing on backend + frontend checks.

## After Sprint A

If this sprint lands cleanly, Sprint B should start immediately with:
- order state machine enforcement
- structured risk-check responses
- portfolio consistency for fill/cancel/reject flows
