# Post-MVP Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前项目从“私有部署、自用型量化研究 MVP”继续升级为“稳定、可信、可高频使用的私有研究系统”，并为未来半自动执行辅助预留清晰接口。

**Architecture:** 保持现有 Rust + Next.js + Docker 的基础架构不变，避免做破坏性重构。优先通过补测试、增强状态可见性、扩展研究工作流、补充数据语义与最小运维能力来推进项目，而不是一次性引入新的复杂子系统。

**Tech Stack:** Rust (Axum/sqlx/Postgres/Redis), Next.js, React Query, Docker Compose, Nginx

---

## File Structure

### 后端核心
- Modify: `src/main.rs`
  - 承载健康检查、回测、策略、成交与未来状态聚合 API
- Modify: `src/strategy/mod.rs`
  - 承载策略执行、回测、参数快照、数据来源与实验管理逻辑
- Modify: `src/portfolio/mod.rs`
  - 承载真实成交、持仓与参考执行数据读取
- Modify: `src/types.rs`
  - 承载策略、回测、实验、状态与数据质量相关类型
- Create/Modify: `src/error.rs`
  - 统一错误分类与面向用户的失败提示

### 前端核心
- Modify: `frontend/src/app/strategies/page.tsx`
  - 继续承载策略管理、模板起步、回测入口
- Modify: `frontend/src/app/backtest/page.tsx`
  - 承载回测历史、详情、实验对比与导出
- Modify: `frontend/src/app/trading/page.tsx`
  - 清理现有 warning，并为未来状态聚合视图预留接入点
- Modify: `frontend/src/lib/api.ts`
  - 增补状态、实验、运维、数据质量接口封装
- Modify: `frontend/src/types/index.ts`
  - 补齐实验、数据质量、状态摘要类型

### 测试与运维
- Create/Modify: `frontend/tests/` 或现有前端测试目录
  - 增加 UI smoke test 与关键 helper 测试
- Create/Modify: `tests/` 或现有 Rust 测试模块
  - 增加回测边界条件、数据质量、实验管理相关测试
- Modify: `scripts/deploy.sh`
  - 如有必要，补充最小状态输出来支撑运维可见性

### 文档
- Modify: `README.md`
  - 继续同步产品定位与操作流程
- Modify: `docs/DEPLOYMENT_SOP.md`
  - 固化稳定性 Sprint 后的运维流程
- Modify/Create: `docs/BACKUP_RESTORE.md`
  - 记录演练后的真实恢复路径
- Reference: `docs/superpowers/specs/2026-04-02-post-mvp-roadmap-design.md`
  - 当前 roadmap 设计规格
- Create: `docs/superpowers/plans/2026-04-02-post-mvp-roadmap.md`
  - 当前实施计划

---

## Delivery Strategy

本计划按四个阶段推进，但执行策略不是并行铺开，而是严格按优先级逐段完成。

### Phase 1: 运行稳定性

**目标：** 把当前系统从“自己能用”提升为“长期跑着也省心”。

**验收标准：**
- 主链路具备自动化 smoke test
- 已知 warning 和低风险技术债明显下降
- 备份恢复流程完成一次真实演练
- 部署后可快速判断系统状态与最近失败情况

### Phase 2: 研究工作流

**目标：** 把当前偏单次回测的体验升级成更像“实验工作台”的体验。

**验收标准：**
- 支持同一策略多参数批量实验
- 支持标签、备注、版本说明
- 支持结果排序、筛选与实验对比
- 导出结果可支撑离线复盘

### Phase 3: 数据与可信度

**目标：** 让用户更清楚知道结果来自什么数据、基于什么假设、哪些地方存在局限。

**验收标准：**
- 回测结果展示数据质量状态
- 假设说明完整且稳定
- 关键边界条件具备测试保护
- 真实执行与研究结果的关系表达更准确

### Phase 4: 半自动执行辅助

**目标：** 为未来“研究指导执行”建立最小但清晰的产品和数据基础。

**验收标准：**
- 用户可查看策略最近回测、最近信号、最近真实成交
- 用户可在同一视图中对比研究结果与真实执行
- 仍保留人工确认，不进入全自动执行

---

## Task 1: 运行稳定性 Sprint

**Files:**
- Modify: `frontend/src/app/strategies/page.tsx`
- Modify: `frontend/src/app/backtest/page.tsx`
- Modify: `frontend/src/app/trading/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `src/main.rs`
- Modify: `src/error.rs`
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT_SOP.md`
- Modify/Create: `docs/BACKUP_RESTORE.md`

- [ ] **Step 1: 收敛当前 warning 与低风险技术债**

优先处理：
- [frontend/src/app/trading/page.tsx](frontend/src/app/trading/page.tsx) 中现有 lint warning
- 主链路页面中已知但未清理的重复状态逻辑或提示不一致问题

Run: `cd frontend && npm run lint`
Expected: 现有已知 warning 至少减少到 0 或被明确记录为暂缓项。

- [ ] **Step 2: 增加最小 UI smoke test**

覆盖关键流程：
- 新建策略
- 编辑策略
- 删除策略
- 运行回测
- 展开/收起回测详情
- 导出回测结果

Run: `rg -n "playwright|vitest|testing-library|smoke" frontend`
Expected: 能看到明确的 smoke test 入口与最小覆盖范围。

- [ ] **Step 3: 增加最小运维可见性**

至少包含：
- 最近部署时间
- 当前健康状态
- 最近回测失败记录或最近错误摘要

优先选择最小实现，可以是：
- 新 API 聚合接口
- 或部署状态页中的简洁摘要模块

Run: `cargo test --no-run && cd frontend && npm run type-check`
Expected: 后端和前端类型构建通过。

- [ ] **Step 4: 完成备份恢复真实演练并同步文档**

要求：
- 不是只写文档，而是按文档真实走一遍恢复流程
- 将最终步骤、注意事项、常见失败点写入 [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md)

Run: `./scripts/deploy.sh status`
Expected: 服务仍健康，恢复步骤明确可复现。

- [ ] **Step 5: 提交阶段成果**

Run:
```bash
git add README.md docs/DEPLOYMENT_SOP.md docs/BACKUP_RESTORE.md src/main.rs src/error.rs frontend/src/app/strategies/page.tsx frontend/src/app/backtest/page.tsx frontend/src/app/trading/page.tsx frontend/src/lib/api.ts frontend/src/types/index.ts
git commit -m "feat: improve runtime stability and observability"
```

Expected: 形成独立的稳定性提交。

---

## Task 2: 研究工作流 Sprint

**Files:**
- Modify: `frontend/src/app/strategies/page.tsx`
- Modify: `frontend/src/app/backtest/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `src/main.rs`
- Modify: `src/strategy/mod.rs`
- Modify: `src/types.rs`

- [ ] **Step 1: 增加批量实验能力**

支持用户为同一策略提交多个参数组合进行连续回测。

最小交付建议：
- 一次选择 2-5 组参数
- 后端顺序执行并保存为同一实验批次
- 前端在回测页按实验批次查看结果

Run: `rg -n "backtest|parameters|compare|export" frontend/src/app/backtest/page.tsx src/strategy/mod.rs`
Expected: 能定位当前对比与回测入口，便于挂接实验批次逻辑。

- [ ] **Step 2: 增加实验标签、备注与版本说明**

要求：
- 每次回测或实验批次可附加标签
- 支持备注
- 支持记录参数版本说明

Run: `cargo test --no-run`
Expected: 类型和持久化层支持新增字段。

- [ ] **Step 3: 升级结果对比为实验对比**

支持：
- 按策略筛选
- 按标签筛选
- 按时间筛选
- 按参数版本筛选
- 按收益率、回撤、Sharpe 排序

Run: `cd frontend && npm run type-check`
Expected: 前端类型和比较视图通过。

- [ ] **Step 4: 增加导出增强**

导出内容至少包括：
- 单次回测完整快照
- 同一实验批次对比导出

建议保留 JSON/CSV 两种格式。

Run: `cd frontend && npm run lint`
Expected: 导出相关逻辑不引入新的 lint 问题。

- [ ] **Step 5: 提交阶段成果**

Run:
```bash
git add src/main.rs src/strategy/mod.rs src/types.rs frontend/src/app/strategies/page.tsx frontend/src/app/backtest/page.tsx frontend/src/lib/api.ts frontend/src/types/index.ts
git commit -m "feat: add experiment-oriented research workflow"
```

Expected: 研究工作流能力形成独立提交。

---

## Task 3: 数据与可信度 Sprint

**Files:**
- Modify: `frontend/src/app/backtest/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `src/main.rs`
- Modify: `src/strategy/mod.rs`
- Modify: `src/portfolio/mod.rs`
- Modify: `src/types.rs`

- [ ] **Step 1: 为回测结果增加数据质量标识**

至少覆盖：
- 本地数据命中
- 外部数据源回退
- 数据不足
- 缺失区间提示

Run: `rg -n "data source|source|quality|缺失|fallback" src frontend/src`
Expected: 数据来源和结果展示路径可统一接入质量状态。

- [ ] **Step 2: 强化回测假设说明**

在回测详情中稳定展示：
- 手续费
- 滑点
- 最大仓位占比
- 调仓逻辑
- 数据来源

Run: `cd frontend && npm run type-check`
Expected: 假设说明在详情区有稳定类型支持。

- [ ] **Step 3: 增加关键边界测试**

至少覆盖：
- 极短时间区间
- 无可用行情数据
- 数据不连续
- 策略改名后历史结果展示一致性

Run: `cargo test --no-run`
Expected: 边界条件具备自动化保护。

- [ ] **Step 4: 收敛真实执行与研究结果的关系表达**

目标：
- 不再让用户误以为两者天然一一对应
- 如果只是参考匹配，就明确写成参考
- 如果未来能建立显式关联，则预留字段与 UI 文案

Run: `cd frontend && npm run lint`
Expected: 相关文案与展示逻辑一致。

- [ ] **Step 5: 提交阶段成果**

Run:
```bash
git add src/main.rs src/strategy/mod.rs src/portfolio/mod.rs src/types.rs frontend/src/app/backtest/page.tsx frontend/src/lib/api.ts frontend/src/types/index.ts
git commit -m "feat: improve backtest data quality and trust signals"
```

Expected: 可信度增强形成独立提交。

---

## Task 4: 半自动执行辅助 Sprint

**Files:**
- Modify: `frontend/src/app/backtest/page.tsx`
- Modify: `frontend/src/app/trading/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `src/main.rs`
- Modify: `src/portfolio/mod.rs`
- Modify: `src/types.rs`

- [ ] **Step 1: 增加策略最新状态概览**

至少展示：
- 最近一次回测
- 最近一次信号
- 最近一次真实成交

Run: `rg -n "signal|trade|position|backtest" frontend/src/app/trading/page.tsx src/main.rs src/portfolio/mod.rs`
Expected: 能定位当前状态来源并设计最小聚合接口。

- [ ] **Step 2: 增加研究结果与真实执行并排复盘视图**

要求：
- 同一策略维度下查看
- 明确区分模拟结果、参考执行、真实执行
- 保留清晰文案避免误导

Run: `cd frontend && npm run type-check`
Expected: 新视图类型收敛，页面仍可维护。

- [ ] **Step 3: 为未来信号确认台预留数据接口**

当前不必做完整自动化执行，只需要：
- 定义最小信号摘要结构
- 聚合最近信号
- 预留人工确认入口位置

Run: `cargo test --no-run`
Expected: 后端类型与接口具备最小扩展能力。

- [ ] **Step 4: 提交阶段成果**

Run:
```bash
git add src/main.rs src/portfolio/mod.rs src/types.rs frontend/src/app/backtest/page.tsx frontend/src/app/trading/page.tsx frontend/src/lib/api.ts frontend/src/types/index.ts
git commit -m "feat: lay groundwork for semi-automated execution support"
```

Expected: 执行辅助基础能力形成独立提交。

---

## Verification Checklist

在每个阶段完成前，至少执行以下验证：

- [ ] `cargo test --no-run`
- [ ] `cd frontend && npm run type-check`
- [ ] `cd frontend && npm run lint`
- [ ] `./scripts/deploy.sh refresh backend`（涉及后端改动时）
- [ ] `./scripts/deploy.sh refresh frontend`（涉及前端改动时）
- [ ] `./scripts/deploy.sh status`
- [ ] `curl -fsS http://localhost:3002/health`

如阶段涉及用户主链路交互，建议额外补一轮手工 smoke test：

- [ ] 创建策略
- [ ] 编辑策略
- [ ] 运行回测
- [ ] 查看报告
- [ ] 导出结果

---

## Notes

- 本计划明确不在当前阶段推进多用户、权限、SaaS 化、全自动实盘和复杂组合管理。
- 每个 Task 都应尽量保持独立提交，避免再次把多个方向的大改动混在一起。
- 如果 Phase 1 未达标，不建议开启 Phase 2。
- 如果 Phase 2 和 Phase 3 还未稳定，不建议进入 Phase 4。
