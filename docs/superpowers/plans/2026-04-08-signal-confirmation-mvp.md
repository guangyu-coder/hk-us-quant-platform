# Signal Confirmation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为交易页补齐“最新信号快照 + 人工确认预填订单”的最小可用链路，并让回测页与交易页共享一致的信号摘要语义。

**Architecture:** 复用现有 Rust 策略引擎与 Next.js 交易页，不引入完整信号历史流，只新增“最新信号快照”读写与刷新接口。前端采用“首屏全量 + 当前策略轮询 + 手动刷新”的方式，维持范围可控并明确保留人工确认边界。

**Tech Stack:** Rust (Axum/sqlx/Postgres), Next.js, React Query, Vitest, Node test runner, Docker Compose

---

## File Structure

- Modify: `src/types.rs`
  - 新增信号快照与预填订单建议类型，扩展现有策略状态结构
- Modify: `src/strategy/mod.rs`
  - 复用策略信号生成逻辑，补“最新信号快照”生成与读取入口
- Modify: `src/main.rs`
  - 暴露信号列表与单策略刷新 API，更新 `strategy state` 复用真实信号快照
- Modify: `frontend/src/types/index.ts`
  - 对齐信号快照、建议订单、刷新响应类型
- Modify: `frontend/src/lib/api.ts`
  - 增加信号列表与刷新接口封装
- Modify: `frontend/src/app/trading/page.tsx`
  - 增加待确认信号区、首屏全量加载、当前策略自动刷新、预填订单
- Modify: `frontend/src/app/backtest/page.tsx`
  - 将复盘区的 `recent_signal` 从 placeholder 升级为真实信号快照展示
- Modify: `frontend/tests/ui-smoke.test.tsx`
  - 增加待确认信号展示与预填订单 smoke 覆盖
- Modify: `frontend/tests/` 现有 helper test 或新增测试文件
  - 覆盖信号快照展示与预填逻辑

---

## Task 1: 后端信号快照类型与接口

**Files:**
- Modify: `src/types.rs`
- Modify: `src/main.rs`
- Test: `src/main.rs` 现有 `http_e2e_tests`

- [ ] **Step 1: 写出后端类型测试目标**

在 `src/main.rs` 的 `http_e2e_tests` 中新增一个最小测试，名字建议：

```rust
#[test]
fn strategy_signal_snapshot_json_keeps_manual_confirmation_boundary() {
    // 断言返回结构包含 strategy_id / signal_type / suggested_order
    // 断言 confirmation_state 是 manual_review_only
    // 断言 note 明确不是自动下单
}
```

- [ ] **Step 2: 运行测试确认先失败**

Run: `cargo test strategy_signal_snapshot_json_keeps_manual_confirmation_boundary -- --nocapture`
Expected: FAIL，提示缺少类型、序列化 helper 或接口返回结构。

- [ ] **Step 3: 在后端类型中加入最小信号快照结构**

在 `src/types.rs` 中新增：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StrategySuggestedOrderDraft {
    pub symbol: String,
    pub side: String,
    pub quantity: i64,
    pub strategy_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StrategySignalSnapshot {
    pub strategy_id: String,
    pub strategy_name: Option<String>,
    pub symbol: Option<String>,
    pub timeframe: Option<String>,
    pub signal_type: Option<SignalType>,
    pub strength: Option<f64>,
    pub generated_at: DateTime<Utc>,
    pub source: String,
    pub confirmation_state: String,
    pub note: String,
    pub suggested_order: Option<StrategySuggestedOrderDraft>,
}
```

并把 `StrategyRecentSignalSummary` 调整为兼容该结构，或直接让 `StrategyExecutionOverview.recent_signal` 使用同一套字段。

- [ ] **Step 4: 在 `src/main.rs` 添加 JSON helper**

新增一个 helper，建议形态：

```rust
fn strategy_signal_snapshot_to_json(snapshot: StrategySignalSnapshot) -> Value {
    json!({
        "strategy_id": snapshot.strategy_id,
        "strategy_name": snapshot.strategy_name,
        "symbol": snapshot.symbol,
        "timeframe": snapshot.timeframe,
        "signal_type": snapshot.signal_type.map(|value| format!("{:?}", value)),
        "strength": snapshot.strength,
        "generated_at": snapshot.generated_at.to_rfc3339(),
        "source": snapshot.source,
        "confirmation_state": snapshot.confirmation_state,
        "note": snapshot.note,
        "suggested_order": snapshot.suggested_order.map(|draft| json!({
            "symbol": draft.symbol,
            "side": draft.side,
            "quantity": draft.quantity,
            "strategy_id": draft.strategy_id,
        })),
    })
}
```

- [ ] **Step 5: 在 `src/main.rs` 增加信号接口路由**

在 `create_router(...)` 中新增：

```rust
.route("/api/v1/signals/latest", get(list_latest_signals))
.route(
    "/api/v1/strategies/:strategy_id/signals/refresh",
    post(refresh_strategy_signal),
)
```

- [ ] **Step 6: 实现 handler 的最小空结构**

先在 `src/main.rs` 中写最小 handler：

```rust
async fn list_latest_signals(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(json!([])))
}

async fn refresh_strategy_signal(
    State(_state): State<AppState>,
    Path(strategy_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({
        "strategy_id": strategy_id,
        "confirmation_state": "manual_review_only",
    })))
}
```

这一步只为把路由和最小返回形状接通。

- [ ] **Step 7: 运行测试确认进入下一类失败**

Run: `cargo test strategy_signal_snapshot_json_keeps_manual_confirmation_boundary -- --nocapture`
Expected: FAIL，但已经从“缺类型/缺路由”推进到“返回内容不足”。

- [ ] **Step 8: 提交阶段性最小骨架**

```bash
git add src/types.rs src/main.rs
git commit -m "feat: scaffold signal snapshot API"
```

---

## Task 2: 复用策略引擎生成最新信号快照

**Files:**
- Modify: `src/strategy/mod.rs`
- Modify: `src/main.rs`
- Modify: `src/types.rs`
- Test: `src/main.rs` / `src/strategy/mod.rs` 中现有测试模块

- [ ] **Step 1: 写出最新信号快照生成测试**

在后端测试里新增一个最小单元测试，名字建议：

```rust
#[test]
fn build_signal_snapshot_marks_manual_review_and_suggested_order() {
    // 给定一个 Buy 信号
    // 断言 suggested_order.side == "Buy"
    // 断言 quantity 默认回退到 100
    // 断言 note 含“人工确认”
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test build_signal_snapshot_marks_manual_review_and_suggested_order -- --nocapture`
Expected: FAIL，提示缺少信号快照 builder。

- [ ] **Step 3: 在 `src/strategy/mod.rs` 添加最新信号快照构建函数**

新增最小 helper，示例形态：

```rust
pub fn build_strategy_signal_snapshot(
    strategy_id: String,
    strategy_name: Option<String>,
    timeframe: Option<String>,
    signal: Signal,
) -> StrategySignalSnapshot {
    let side = match signal.signal_type {
        SignalType::Buy => "Buy",
        SignalType::Sell => "Sell",
        SignalType::Hold => "Buy",
    };

    StrategySignalSnapshot {
        strategy_id: strategy_id.clone(),
        strategy_name,
        symbol: Some(signal.symbol.clone()),
        timeframe,
        signal_type: Some(signal.signal_type),
        strength: Some(signal.strength),
        generated_at: signal.timestamp,
        source: "strategy_engine_latest_snapshot".to_string(),
        confirmation_state: "manual_review_only".to_string(),
        note: "研究信号仅用于人工确认，不会自动下单。".to_string(),
        suggested_order: Some(StrategySuggestedOrderDraft {
            symbol: signal.symbol,
            side: side.to_string(),
            quantity: 100,
            strategy_id,
        }),
    }
}
```

- [ ] **Step 4: 在 `src/main.rs` 中实现单策略刷新**

`refresh_strategy_signal(...)` 改为：

1. 读取策略配置
2. 根据策略配置里的 `symbol/timeframe` 获取一份最新市场数据
3. 调用策略服务生成信号
4. 取最新一条非 `Hold` 信号
5. 生成 `StrategySignalSnapshot`
6. 若没有信号，则返回一个 `signal_type = null` 但语义清晰的快照

关键返回语义：

```rust
"confirmation_state": "manual_review_only"
"note": "研究信号仅用于人工确认，不会自动下单。"
```

- [ ] **Step 5: 在 `src/main.rs` 中实现全量信号列表**

`list_latest_signals(...)` 改为：

1. 读取全部活跃策略
2. 对每个策略生成一条最新信号快照
3. 返回数组

如果某个策略生成失败，不要让整个接口失败；改为返回该策略的“失败快照”：

```rust
{
  "status": "error",
  "note": "行情不足或策略生成失败"
}
```

如果你不想新增 `status` 字段，就把失败信息写进 `note`，但要保证前端能区分“暂无信号”和“生成失败”。

- [ ] **Step 6: 把 `strategy state` 接口里的 `recent_signal` 改成复用真实快照**

`get_strategy_state(...)` 中不要再只返回 placeholder。

改为：
- 优先放最新真实信号快照
- 若确实生成不到，再退回 placeholder 样式快照

- [ ] **Step 7: 运行后端测试**

Run:
```bash
cargo test build_signal_snapshot_marks_manual_review_and_suggested_order -- --nocapture
cargo test strategy_execution_overview_separates_research_and_real_execution -- --nocapture
cargo test --no-run
```
Expected: 全部 PASS。

- [ ] **Step 8: 提交后端信号快照逻辑**

```bash
git add src/types.rs src/strategy/mod.rs src/main.rs
git commit -m "feat: generate latest strategy signal snapshots"
```

---

## Task 3: 前端 API、类型与待确认信号区

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/trading/page.tsx`
- Test: `frontend/tests/ui-smoke.test.tsx`

- [ ] **Step 1: 先写 smoke 断言**

在 `frontend/tests/ui-smoke.test.tsx` 中新增断言，名字建议保留现有 suite 并补充：

```ts
await screen.findByText('待确认信号');
await screen.findByText(/按此信号预填订单/);
```

并在 mock 里添加：

```ts
listLatestSignals: vi.fn(),
refreshStrategySignal: vi.fn(),
```

- [ ] **Step 2: 跑 smoke 确认失败**

Run: `cd frontend && npm run test:smoke`
Expected: FAIL，提示交易页中不存在待确认信号模块。

- [ ] **Step 3: 在前端类型中补齐信号快照**

在 `frontend/src/types/index.ts` 中新增：

```ts
export interface StrategySuggestedOrderDraft {
  symbol: string;
  side: OrderSide;
  quantity: number;
  strategy_id: string;
}

export interface StrategySignalSnapshot {
  strategy_id: string;
  strategy_name?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  signal_type?: SignalType | null;
  strength?: number | null;
  generated_at: string;
  source: string;
  confirmation_state: string;
  note: string;
  suggested_order?: StrategySuggestedOrderDraft | null;
}
```

并让 `StrategyExecutionOverview.recent_signal` 兼容这一结构。

- [ ] **Step 4: 在 API 层补接口**

在 `frontend/src/lib/api.ts` 中新增：

```ts
export const signalApi = {
  listLatestSignals: async (filters?: { strategy_id?: string; limit?: number }) =>
    api.get('/v1/signals/latest', { params: filters }),
  refreshStrategySignal: async (strategyId: string) =>
    api.post(`/v1/strategies/${strategyId}/signals/refresh`),
};
```

- [ ] **Step 5: 在交易页增加待确认信号列表**

在 `frontend/src/app/trading/page.tsx` 中加入：

1. 首屏 query：

```ts
const { data: latestSignals = [] } = useQuery({
  queryKey: ['latest-signals'],
  queryFn: () => signalApi.listLatestSignals(),
  staleTime: 10000,
});
```

2. 当前策略状态：

```ts
const [focusedStrategyId, setFocusedStrategyId] = useState<string | null>(null);
```

3. 展示模块：

```tsx
<div className="rounded-lg border border-amber-200 bg-white shadow">
  <div className="border-b border-amber-100 px-6 py-4">
    <h3 className="text-lg font-medium text-slate-900">待确认信号</h3>
    <p className="mt-1 text-sm text-slate-500">
      这些信号来自策略引擎的最新快照，仅用于人工确认，不会自动下单。
    </p>
  </div>
</div>
```

每条卡片至少展示：
- 策略名
- 标的 / 周期
- 方向 / 强度
- 生成时间
- 说明文案
- `按此信号预填订单`

- [ ] **Step 6: 让“按此信号预填订单”带值进入表单**

在交易页新增一个 helper：

```ts
const prefillOrderFromSignal = (signal: StrategySignalSnapshot) => {
  const draft = signal.suggested_order;
  if (!draft) return;

  setShowOrderForm(true);
  setOrderForm((current) => ({
    ...current,
    symbol: draft.symbol,
    side: draft.side,
    quantity: String(draft.quantity),
    order_type: 'Market',
  }));
  setSignalPrefillNotice(
    `${signal.strategy_name ?? signal.strategy_id} 的 ${signal.signal_type ?? '待确认'} 信号已带入订单表单，请人工确认后提交。`
  );
};
```

同时保证订单提交 payload 能继续带上 `strategy_id`。

- [ ] **Step 7: 跑前端验证**

Run:
```bash
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```
Expected: 全部 PASS。

- [ ] **Step 8: 提交交易页待确认信号区**

```bash
git add frontend/src/types/index.ts frontend/src/lib/api.ts frontend/src/app/trading/page.tsx frontend/tests/ui-smoke.test.tsx
git commit -m "feat: add signal confirmation queue to trading page"
```

---

## Task 4: 当前策略自动刷新与手动刷新

**Files:**
- Modify: `frontend/src/app/trading/page.tsx`
- Test: `frontend/tests/ui-smoke.test.tsx`

- [ ] **Step 1: 写自动刷新行为测试**

补一个最小测试思路：

```ts
// 首次加载调用 listLatestSignals
// 选中策略后调用 refreshStrategySignal
// 点击“立即刷新”再次调用 refreshStrategySignal
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npm run test:smoke`
Expected: FAIL，提示刷新行为未发生。

- [ ] **Step 3: 实现首屏全量 + 当前策略轮询**

在交易页中增加：

```ts
useEffect(() => {
  if (!focusedStrategyId) return;

  const timer = window.setInterval(() => {
    signalApi.refreshStrategySignal(focusedStrategyId).then(/* merge into local state */);
  }, 15000);

  return () => window.clearInterval(timer);
}, [focusedStrategyId]);
```

规则：
- 初次进入页面只拉全量
- 用户点击某条信号后，把该策略设为 `focusedStrategyId`
- 之后只刷新该策略

- [ ] **Step 4: 实现手动刷新按钮**

在待确认信号模块顶部增加：

```tsx
<button type="button" onClick={handleManualRefresh}>
  立即刷新
</button>
```

逻辑：
- 如果有 `focusedStrategyId`，刷新单策略
- 如果没有，刷新全部活跃策略列表

- [ ] **Step 5: 增加空状态和错误提示**

至少处理：
- 无活跃策略
- 暂无信号
- 当前策略刷新失败

文案示例：

```tsx
{latestSignals.length === 0 && (
  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
    当前没有可确认的最新信号，你可以先手动刷新，或等待策略产生新信号。
  </div>
)}
```

- [ ] **Step 6: 跑前端验证**

Run:
```bash
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
```
Expected: 全部 PASS。

- [ ] **Step 7: 提交刷新策略**

```bash
git add frontend/src/app/trading/page.tsx frontend/tests/ui-smoke.test.tsx
git commit -m "feat: add focused signal refresh workflow"
```

---

## Task 5: 回测页联动与统一语义

**Files:**
- Modify: `frontend/src/app/backtest/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`
- Test: `frontend/tests/ui-smoke.test.tsx`

- [ ] **Step 1: 写回测页展示断言**

在 smoke 中补：

```ts
await screen.findByText('研究与真实执行复盘');
await screen.findByText(/人工确认/);
```

如果已有类似断言，则改成匹配真实信号快照文案。

- [ ] **Step 2: 跑 smoke 确认失败或断言不完整**

Run: `cd frontend && npm run test:smoke`
Expected: FAIL，或虽然 PASS 但还未展示真实信号字段。

- [ ] **Step 3: 在回测页复盘区展示真实信号快照**

将 [frontend/src/app/backtest/page.tsx](/Users/liguangyu/githubProj/hk-us-quant-platform/frontend/src/app/backtest/page.tsx) 中的“信号确认占位”升级为：

- 若 `recent_signal.signal_type` 存在，则显示：
  - 方向
  - 强度
  - 生成时间
  - 建议订单方向/数量
- 若不存在，则显示明确空状态

保留边界文案：

```tsx
<div className="text-xs text-slate-500">
  该信号仅用于人工确认，不会自动触发下单。
</div>
```

- [ ] **Step 4: 确认回测页与交易页使用同一套字段名**

检查：
- `signal_type`
- `strength`
- `generated_at`
- `confirmation_state`
- `suggested_order`

不要出现一边叫 `latest_signal_at`、另一边叫 `generated_at` 的漂移。

- [ ] **Step 5: 跑完整前端验证**

Run:
```bash
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
cd frontend && node --test --experimental-strip-types tests/backtest-report.test.ts tests/backtest-efficiency.test.ts tests/backtest-page-helpers.test.ts tests/strategy-page-helpers.test.ts tests/strategy-workflow.test.ts
```
Expected: 全部 PASS。

- [ ] **Step 6: 提交回测页联动**

```bash
git add frontend/src/app/backtest/page.tsx frontend/src/lib/api.ts frontend/src/types/index.ts frontend/tests/ui-smoke.test.tsx
git commit -m "feat: align backtest review with latest signal snapshots"
```

---

## Task 6: 最终验证与部署

**Files:**
- Modify: 如前述所有文件

- [ ] **Step 1: 跑后端完整验证**

Run:
```bash
cargo test --no-run
cargo test strategy_signal_snapshot_json_keeps_manual_confirmation_boundary -- --nocapture
cargo test build_signal_snapshot_marks_manual_review_and_suggested_order -- --nocapture
cargo test strategy_execution_overview_separates_research_and_real_execution -- --nocapture
```
Expected: 全部 PASS。

- [ ] **Step 2: 跑前端完整验证**

Run:
```bash
cd frontend && npm run type-check
cd frontend && npm run lint
cd frontend && npm run test:smoke
cd frontend && node --test --experimental-strip-types tests/backtest-report.test.ts tests/backtest-efficiency.test.ts tests/backtest-page-helpers.test.ts tests/strategy-page-helpers.test.ts tests/strategy-workflow.test.ts
```
Expected: 全部 PASS。

- [ ] **Step 3: 部署后端与前端**

Run:
```bash
./scripts/deploy.sh refresh backend
./scripts/deploy.sh refresh frontend
./scripts/deploy.sh status
curl -fsS http://localhost:3002/health
```
Expected:
- backend / frontend / nginx / postgres / redis 全部 Up
- `/health` 返回 `healthy`

- [ ] **Step 4: 核验真实接口**

Run:
```bash
curl -fsS http://localhost:3002/api/v1/signals/latest
curl -fsS http://localhost:3002/api/v1/strategies/<strategy-id>/signals/refresh
curl -fsS http://localhost:3002/api/v1/strategies/<strategy-id>/state
```
Expected:
- 能看到最新信号快照
- `confirmation_state = manual_review_only`
- `suggested_order` 存在或在“暂无信号”场景下明确为空

- [ ] **Step 5: 最终提交**

```bash
git add src/types.rs src/strategy/mod.rs src/main.rs frontend/src/types/index.ts frontend/src/lib/api.ts frontend/src/app/trading/page.tsx frontend/src/app/backtest/page.tsx frontend/tests/ui-smoke.test.tsx docs/superpowers/plans/2026-04-08-signal-confirmation-mvp.md
git commit -m "feat: add signal confirmation mvp"
```

---

## Verification Checklist

- [ ] `cargo test --no-run`
- [ ] `cargo test strategy_signal_snapshot_json_keeps_manual_confirmation_boundary -- --nocapture`
- [ ] `cargo test build_signal_snapshot_marks_manual_review_and_suggested_order -- --nocapture`
- [ ] `cargo test strategy_execution_overview_separates_research_and_real_execution -- --nocapture`
- [ ] `cd frontend && npm run type-check`
- [ ] `cd frontend && npm run lint`
- [ ] `cd frontend && npm run test:smoke`
- [ ] `cd frontend && node --test --experimental-strip-types tests/backtest-report.test.ts tests/backtest-efficiency.test.ts tests/backtest-page-helpers.test.ts tests/strategy-page-helpers.test.ts tests/strategy-workflow.test.ts`
- [ ] `./scripts/deploy.sh refresh backend`
- [ ] `./scripts/deploy.sh refresh frontend`
- [ ] `./scripts/deploy.sh status`
- [ ] `curl -fsS http://localhost:3002/health`
