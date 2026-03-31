# Sprint Backlog (2 Weeks)

## Epic 1: Stability
1. `[Stability] Unified market-data error handling and graceful degradation`
2. `[Stability] Frontend numeric guardrails for market fields`
3. `[Stability] Normalize history interval mapping end-to-end`

## Epic 2: Security & Config
1. `[Security/Config] Remove hardcoded API keys and env-driven key loading`
2. `[Security/Config] Align README with actual API/WS behavior`
3. `[Security/Config] Standardize startup scripts and port conflict handling`

## Epic 3: Trading Core
1. `[Trading Core] Enforce order status state machine`
2. `[Trading Core] Configurable risk rules and structured reject reasons`
3. `[Trading Core] Position and PnL consistency for fill/cancel flows`

## Epic 4: CI & Observability
1. `[CI/Observability] Add backend/frontend quality gates in CI`
2. `[CI/Observability] Run e2e smoke tests with Postgres/Redis in CI`
3. `[CI/Observability] Add metrics for success rate, p95 latency, upstream failure rate`

## Done Definition
1. Main user flow pages run without runtime crash under intermittent upstream failures.
2. No plaintext secrets in repo.
3. CI gates pass with reproducible local commands.
4. Docs and runtime behavior are aligned.
