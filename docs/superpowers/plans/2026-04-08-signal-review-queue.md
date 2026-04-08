# Signal Review Queue MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有最新信号快照链路之上，补齐“待处理信号留痕 + 确认/忽略/备注”的最小闭环。

**Architecture:** 后端新增最小 `signal_reviews` 持久化模型与处理接口；前端在交易页把实时快照升级成待处理队列。继续保留人工确认边界，不引入自动执行。

**Tech Stack:** Rust (Axum/sqlx/Postgres), Next.js, React Query, Vitest, Docker Compose

## File Structure

- Add: `migrations/010_signal_reviews.sql`
- Modify: `src/types.rs`
- Modify: `src/main.rs`
- Modify: `src/strategy/mod.rs`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/trading/page.tsx`
- Modify: `frontend/tests/ui-smoke.test.tsx`

## Task 1: 后端信号留痕模型与迁移

**Files:**
- Add: `migrations/010_signal_reviews.sql`
- Modify: `src/types.rs`
- Modify: `src/main.rs`

- [ ] 新增 `signal_reviews` 表迁移
- [ ] 在 Rust 类型中加入 `SignalReviewRecord`
- [ ] 增加最小 JSON 序列化 helper
- [ ] 提交：
```bash
git add migrations/010_signal_reviews.sql src/types.rs src/main.rs
git commit -m "feat: add signal review storage scaffold"
```

## Task 2: 刷新信号时落库并提供查询接口

**Files:**
- Modify: `src/main.rs`
- Modify: `src/strategy/mod.rs`
- Modify: `src/types.rs`

- [ ] 在生成最新信号快照后 upsert 到 `signal_reviews`
- [ ] 新增 `GET /api/v1/signals/reviews`
- [ ] 保持 `confirmed / ignored` 历史不被 pending 刷新覆盖
- [ ] 测试：
  - `cargo test --no-run`
  - 最小 review helper / API 测试
- [ ] 提交：
```bash
git add src/main.rs src/strategy/mod.rs src/types.rs
git commit -m "feat: persist latest signal reviews"
```

## Task 3: 确认 / 忽略 / 备注接口

**Files:**
- Modify: `src/main.rs`
- Modify: `src/types.rs`

- [ ] 新增：
  - `POST /api/v1/signals/reviews/:id/confirm`
  - `POST /api/v1/signals/reviews/:id/ignore`
  - `PATCH /api/v1/signals/reviews/:id/note`
- [ ] 保证状态流转清晰
- [ ] 补最小 API 测试
- [ ] 提交：
```bash
git add src/main.rs src/types.rs
git commit -m "feat: add signal review actions"
```

## Task 4: 交易页待处理队列

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/trading/page.tsx`
- Modify: `frontend/tests/ui-smoke.test.tsx`

- [ ] 前端类型补齐 `SignalReviewRecord`
- [ ] 新增 review 查询与操作 API
- [ ] 交易页展示 `pending` 和最近处理摘要
- [ ] 卡片支持：
  - `按此信号预填订单`
  - `标记已确认`
  - `忽略`
- [ ] smoke 覆盖待处理信号操作
- [ ] 提交：
```bash
git add frontend/src/types/index.ts frontend/src/lib/api.ts frontend/src/app/trading/page.tsx frontend/tests/ui-smoke.test.tsx
git commit -m "feat: add signal review queue to trading page"
```

## Task 5: 备注编辑与最终验证

**Files:**
- Modify: `frontend/src/app/trading/page.tsx`
- Modify: `frontend/tests/ui-smoke.test.tsx`

- [ ] 增加备注编辑入口
- [ ] 完成前后端验证：
```bash
cargo test --no-run
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```
- [ ] 部署：
```bash
./scripts/deploy.sh refresh backend
./scripts/deploy.sh refresh frontend
./scripts/deploy.sh status
curl -fsS http://localhost:3002/health
```
- [ ] 提交：
```bash
git add frontend/src/app/trading/page.tsx frontend/tests/ui-smoke.test.tsx
git commit -m "feat: complete signal review queue workflow"
```
