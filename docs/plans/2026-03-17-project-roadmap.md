# HK-US Quant Platform Roadmap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Push the current prototype into a stable, testable trading platform with reliable market data, enforceable trading controls, and a production-ready delivery pipeline.

**Architecture:** Keep the current modular monolith approach: Rust backend for trading/data/risk APIs, Next.js frontend for operations UI, Postgres/TimescaleDB for system-of-record and time-series storage, Redis for cache/event fan-out. Avoid introducing new services until the current order, portfolio, risk, and observability paths are deterministic and covered by integration tests.

**Tech Stack:** Rust (Axum, sqlx, Tokio), PostgreSQL/TimescaleDB, Redis, Next.js 14, React, TanStack Query, Docker Compose, GitHub Actions

---

## Current State Summary

The codebase is beyond a skeleton:
- Backend has real routes for market data, strategies, orders, portfolio, risk, lifecycle, and WebSocket.
- Frontend has the main operations pages wired to backend APIs.
- Market data already integrates with Yahoo Finance and has a Python fallback path.
- Broker abstraction and Alpaca adapter exist.
- Data lifecycle cleanup/archival is already started.

The main gaps are not "missing pages", but production depth:
- Backtest, broker execution, and some risk logic still contain placeholder behavior.
- Test coverage is strong for types and validation, but light on DB-backed workflows and real end-to-end flows.
- Security/config hardening and doc/runtime alignment are still in progress.
- The repo is currently in a dirty working tree, so future work should land in focused, reviewed slices.

## Phase 1: Stabilize The Core Prototype (1-2 weeks)

### Objective
Make the existing demo workflow resilient enough for daily development and stakeholder demos.

### Scope
- Unify market data error handling between backend, Python script fallback, and frontend widgets.
- Finish interval normalization end-to-end so `/market` and `/api/v1/market-data/:symbol/history` behave consistently.
- Remove any hardcoded or loosely managed secrets and align startup behavior with `.env` and deployment scripts.
- Make docs match actual runtime behavior, especially API paths, WebSocket behavior, and deployment entrypoints.

### Deliverables
- One market-data contract for success, degraded mode, and upstream failure.
- Frontend widgets that do not crash on empty or partial numeric fields.
- Clean env-driven secret loading for broker/data integrations.
- Updated README/deployment docs with verified commands only.

### Exit Criteria
- Main pages render without runtime crash when upstream quote/history requests fail intermittently.
- No plaintext secrets remain in tracked files.
- Local container startup and refresh flow is reproducible from docs.

## Phase 2: Harden Trading Core (2-4 weeks)

### Objective
Turn order placement, risk checks, and portfolio updates into a consistent system instead of loosely connected endpoints.

### Scope
- Enforce an explicit order state machine in the execution layer.
- Make risk rejection reasons structured and API-visible.
- Ensure fill/cancel flows update positions and PnL deterministically.
- Wire broker submission path behind a clear interface so Mock and Alpaca behave consistently.
- Add audit-grade persistence for order transitions and risk decisions.

### Deliverables
- Allowed order transitions documented and enforced in code.
- Risk API returns machine-readable check results, not only generic pass/fail.
- Portfolio snapshots reflect actual order lifecycle outcomes.
- Mock broker flow becomes the default integration test backbone.

### Exit Criteria
- No invalid transition can move an order from `Rejected` or `Cancelled` back into active states.
- Fill, partial fill, cancel, and reject paths all leave portfolio state consistent.
- A DB-backed integration suite covers strategy signal -> risk check -> order creation -> state update.

## Phase 3: Make Data And Backtest Credible (3-5 weeks)

### Objective
Upgrade the system from “trade dashboard + placeholder analytics” to a research and validation tool.

### Scope
- Replace placeholder backtest results with a real historical simulation pipeline.
- Standardize symbol normalization, timezone handling, and currency/base-currency conversion.
- Add historical bar ingestion/replay for HK/US symbols.
- Separate live quote freshness from historical bar completeness in data quality checks.
- Add benchmark metrics: CAGR, Sharpe, max drawdown, hit ratio, turnover, slippage assumptions.

### Deliverables
- Real backtest engine using stored historical data.
- Strategy result pages backed by computed results rather than static placeholders.
- Data quality dashboard or API summary for missing bars, stale quotes, and archival status.

### Exit Criteria
- Backtest output is reproducible from stored historical inputs.
- Same strategy over same window yields deterministic metrics.
- Historical data coverage gaps are visible before a backtest runs.

## Phase 4: Security, Auth, And Ops Readiness (2-3 weeks)

### Objective
Prepare the platform for multi-user internal usage and safer external connectivity.

### Scope
- Add authentication and role separation for admin, trader, and viewer access.
- Protect write operations for strategies, orders, lifecycle jobs, and settings.
- Add request tracing, metrics, and alertable health checks.
- Introduce GitHub Actions quality gates for backend, frontend, and container smoke tests.
- Define broker/data-provider secret rotation and environment promotion process.

### Deliverables
- Auth middleware and frontend session flow.
- CI pipeline for `cargo test`, frontend type/lint, and compose smoke test.
- Metrics for API latency, upstream error rate, order reject rate, and WebSocket connection count.
- Minimal incident runbook for startup failure, DB migration failure, and upstream outage.

### Exit Criteria
- All mutating APIs require authenticated access.
- CI blocks merges on backend/frontend regression.
- Basic monitoring can explain whether failures come from app logic, DB, Redis, or upstream providers.

## Phase 5: Go-Live Preparation For Paper Trading (2-4 weeks)

### Objective
Make the platform safe for continuous paper trading before any live-capital discussion.

### Scope
- Complete Alpaca paper trading integration path and broker reconciliation.
- Add scheduled jobs for account sync, order sync, and stale-position repair.
- Build daily PnL and exposure reports.
- Add kill switch, market-hours controls, and per-strategy capital limits.
- Run shadow mode with generated signals and broker acknowledgements.

### Deliverables
- End-to-end paper trading workflow with reconciliation.
- Operational controls for disabling strategy/order flow quickly.
- Daily review surfaces for fills, rejects, exposure, and data outages.

### Exit Criteria
- Platform can run in paper mode for at least 5 trading days without manual DB intervention.
- Broker state and local state reconcile automatically or raise explicit alerts.
- Emergency stop can block new orders without taking the whole stack down.

## Recommended Priority Order

1. Phase 1 first, because the current repo already exposes real interfaces and unstable edges will slow every later task.
2. Phase 2 second, because order/risk/portfolio consistency is the core platform value.
3. Phase 3 third, because research credibility matters only after system behavior is trustworthy.
4. Phase 4 fourth, because auth/CI/metrics become much easier once the main workflows are stable.
5. Phase 5 last, because paper trading should validate a hardened platform, not compensate for missing core controls.

## Suggested Sprint Breakdown

### Sprint A
- Finish stability/config/doc alignment backlog.
- Add integration tests around market-data failure and degraded frontend rendering.

### Sprint B
- Enforce order state machine.
- Return structured risk check results and persist decision audit trail.

### Sprint C
- Complete portfolio consistency for fill/cancel/reject flows.
- Add DB-backed order lifecycle integration tests.

### Sprint D
- Implement real historical backtest pipeline.
- Expose backtest job/result lifecycle to frontend.

### Sprint E
- Add auth, CI, metrics, and paper-trading operational controls.

## Key Architectural Decisions

### ADR-001: Stay Modular Monolith For Now
- Decision: Keep backend as one Rust service with strong internal module boundaries.
- Why: Current complexity does not justify service sprawl; the bigger risk is inconsistent business logic, not scaling limits.
- Trade-off: Less isolation than splitting trading/data/risk into separate services, but much lower operational overhead.

### ADR-002: Mock Broker Is The Integration Baseline
- Decision: Treat Mock broker as the canonical workflow target for tests, then adapt Alpaca behind the same contract.
- Why: Broker-coupled tests are too brittle to serve as the core feedback loop.
- Trade-off: Requires discipline to keep the mock realistic enough for fill/cancel/partial-fill behavior.

### ADR-003: Backtest Must Run On Stored Data, Not Ad-Hoc API Fetches
- Decision: Historical simulation should operate on persisted bars in Postgres/TimescaleDB.
- Why: Reproducibility and auditability matter more than quick ad-hoc fetches.
- Trade-off: Requires data ingestion/storage work before backtest quality improves.

## Risks And Mitigations

- Risk: README and actual code drift again.
  Mitigation: Ship doc updates in the same PR as behavioral changes.

- Risk: Trading core changes break the frontend silently.
  Mitigation: Add API contract tests and one compose smoke test covering dashboard, strategies, orders, and portfolio endpoints.

- Risk: Live-provider integrations become the center of development too early.
  Mitigation: Keep Mock broker and persisted historical data as the primary test surfaces.

- Risk: Dirty working tree causes accidental overwrite or mixed commits.
  Mitigation: Use narrow-scope branches and isolate future work by milestone.

## Immediate Next 3 Tickets

1. Stabilize market-data failure/degraded-mode contract across backend and frontend.
2. Implement and test explicit order state transition rules.
3. Add DB-backed integration tests for order -> portfolio -> risk consistency.
