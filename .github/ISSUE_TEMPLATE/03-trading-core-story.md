---
name: "Sprint Story: Trading Core"
about: "Use for order lifecycle, risk checks, and portfolio accounting stories"
title: "[Sprint][Trading Core] <short title>"
labels: ["sprint", "trading-core", "backend"]
assignees: []
---

## Goal
Describe the trading workflow capability to implement.

## Scope
- [ ] Order state transitions
- [ ] Risk check rules
- [ ] Position/PnL accounting
- [ ] Event publishing

## Tasks
- [ ] Implement domain logic
- [ ] Add API validation and error semantics
- [ ] Add integration tests for success + failure paths

## Acceptance Criteria
- [ ] State transitions are constrained and tested
- [ ] Risk rejection returns structured reason and category
- [ ] Position/PnL remains consistent after fills/cancels

## Test Plan
- [ ] Unit tests
- [ ] Integration tests with Postgres/Redis
- [ ] Manual API verification steps

## Risk / Rollback
- Risk:
- Rollback plan:

