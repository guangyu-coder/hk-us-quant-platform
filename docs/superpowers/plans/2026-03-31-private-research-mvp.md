# Private Research MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前项目收敛为一个适合私有部署、自主使用的量化研究 MVP，稳定打通“创建策略 → 运行回测 → 查看报告”的主链路。

**Architecture:** 保持现有 Rust + Next.js + Docker 架构不变，以最小改动方式增强策略、回测和部署主链路。前端继续承载研究工作流，后端继续承载策略配置、回测执行和结果持久化，同时补齐测试、错误反馈和文档。

**Tech Stack:** Rust (Axum/sqlx/Postgres/Redis), Next.js, React Query, Docker Compose, Nginx

---

## File Structure

### 后端核心
- Modify: `src/main.rs`
  - 继续承载策略、回测、订单、真实成交和健康检查 API
- Modify: `src/strategy/mod.rs`
  - 继续承载策略配置加载、回测执行、回测持久化、策略删除逻辑
- Modify: `src/types.rs`
  - 统一策略、回测、成交等数据结构
- Modify: `src/portfolio/mod.rs`
  - 维护真实成交列表查询与投资组合账本逻辑

### 前端核心
- Modify: `frontend/src/app/strategies/page.tsx`
  - 承载策略创建、编辑、删除、回测入口
- Modify: `frontend/src/app/backtest/page.tsx`
  - 承载回测历史、详情、筛选、模拟与真实成交展示
- Modify: `frontend/src/lib/api.ts`
  - 前端 API 封装
- Modify: `frontend/src/types/index.ts`
  - 前端数据类型定义

### 文档与部署
- Modify: `README.md`
  - 保持主流程、部署方式和产品定位说明同步
- Modify: `docs/DEPLOYMENT_SOP.md`
  - 固化私有部署与升级步骤
- Create/Modify: `docs/superpowers/specs/2026-03-31-private-research-mvp-design.md`
  - 已完成设计规格
- Create: `docs/superpowers/plans/2026-03-31-private-research-mvp.md`
  - 当前实施计划

---

## Delivery Strategy

本计划分为四个阶段，但只把 **Phase 1 和 Phase 2** 作为近期执行范围。  
Phase 3 和 Phase 4 保留为排队路线，避免当前阶段再次范围膨胀。

### Phase 1: 主链路稳定化

**目标：** 把“创建策略 → 运行回测 → 查看报告”做成一个可信、顺手、稳定的研究闭环。

**验收标准：**
- 策略创建、编辑、删除、回测、查看报告均可稳定使用
- 回测报告不再混淆策略名称/策略类型、模拟成交/真实成交
- 表单、筛选、详情展开/收起、删除确认等高频交互没有明显 bug
- 至少有基础自动化校验覆盖关键路径

### Phase 2: 研究效率增强

**目标：** 提升频繁试验、重复配置与结果比较的效率。

**验收标准：**
- 可以更快复用常见策略配置
- 可以管理常用标的和最近使用项
- 可以比较同一策略多次实验结果
- 可以导出研究结果用于复盘

### Phase 3: 可信度增强

**目标：** 让报告更适合长期研究使用。

### Phase 4: 私有部署完善

**目标：** 让项目适合长期私有运行与升级维护。

---

## Task 1: 策略主链路收尾与一致性修复

**Files:**
- Modify: `frontend/src/app/strategies/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `src/main.rs`
- Modify: `src/strategy/mod.rs`

- [ ] **Step 1: 统一策略表单的字段语义**

确认以下字段在前后端语义保持一致：
- `name` 只作为内部策略类型
- `display_name` 只作为展示名称
- `parameters.symbol` 为研究标的
- `parameters.timeframe` 为研究周期

Run: `rg -n "display_name|timeframe|symbol|name" frontend/src/app/strategies/page.tsx src/main.rs src/strategy/mod.rs src/types.rs`
Expected: 能清晰定位所有相关读写路径，无重复语义冲突。

- [ ] **Step 2: 策略表单补齐剩余体验缺口**

补齐以下交互：
- 参数字段说明文本
- 默认值重置行为
- 提交中禁用重复提交
- API 失败后的可读错误提示

Run: `npm run type-check`
Expected: 通过。

- [ ] **Step 3: 增加策略主链路的基础测试覆盖**

后端至少覆盖：
- 创建策略时 `display_name` 和参数持久化正确
- 删除策略会删除关联数据
- 回测执行会带出当前参数快照

前端至少覆盖：
- 策略表单校验
- 删除确认文案
- 标的搜索选择与周期选择不破坏提交流程

Run: `cargo test --no-run && npm run lint`
Expected: 后端构建通过，前端 lint 仅保留已知 warning。

- [ ] **Step 4: 提交阶段成果**

Run:
```bash
git add src/main.rs src/strategy/mod.rs frontend/src/app/strategies/page.tsx frontend/src/lib/api.ts frontend/src/types/index.ts
git commit -m "feat: stabilize strategy management workflow"
```

Expected: 生成单独提交，能回滚此阶段改动。

---

## Task 2: 回测报告可信度增强

**Files:**
- Modify: `frontend/src/app/backtest/page.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `src/main.rs`
- Modify: `src/strategy/mod.rs`
- Modify: `src/portfolio/mod.rs`

- [ ] **Step 1: 增强回测报告元数据展示**

补齐以下信息展示：
- 参数快照摘要
- 回测时间范围
- 数据来源说明
- 真实成交为空时的明确提示

Run: `rg -n "参数快照|真实成交|模拟成交|策略名称|策略类型" frontend/src/app/backtest/page.tsx`
Expected: 关键语义展示集中在回测详情区域，可维护。

- [ ] **Step 2: 收敛回测报告筛选能力**

保留并强化：
- 按策略筛选
- 按策略名称筛选
- 按标的筛选

新增建议：
- “重置全部筛选”按钮
- 当前筛选摘要

Run: `npm run type-check`
Expected: 通过。

- [ ] **Step 3: 补回测语义相关测试**

至少覆盖：
- 回测名称优先取当前策略展示名称
- 真实成交不会覆盖模拟成交
- 详情展开/收起状态稳定

Run: `cargo test --no-run && npm run lint`
Expected: 通过，前端仅保留既有 warning。

- [ ] **Step 4: 提交阶段成果**

Run:
```bash
git add frontend/src/app/backtest/page.tsx frontend/src/lib/api.ts frontend/src/types/index.ts src/main.rs src/strategy/mod.rs src/portfolio/mod.rs
git commit -m "feat: improve backtest report trustworthiness"
```

Expected: 回测报告相关能力形成独立提交。

---

## Task 3: 回测执行前的参数确认与失败反馈

**Files:**
- Modify: `frontend/src/app/strategies/page.tsx`
- Modify: `src/main.rs`
- Modify: `src/strategy/mod.rs`
- Modify: `src/error.rs`

- [ ] **Step 1: 在回测弹窗中展示参数确认摘要**

显示：
- 策略名称
- 标的
- 周期
- 初始资金
- 手续费/滑点
- 起止时间

Expected: 用户发起回测前可以确认研究条件，不需要返回编辑页再核对。

- [ ] **Step 2: 明确呈现回测失败原因**

后端错误应至少覆盖：
- 历史数据不足
- 参数非法
- 数据源失败

前端应将后端错误直接展示，而不是通用“运行失败”。

Run: `cargo test --no-run && npm run type-check`
Expected: 通过。

- [ ] **Step 3: 提交阶段成果**

Run:
```bash
git add frontend/src/app/strategies/page.tsx src/main.rs src/strategy/mod.rs src/error.rs
git commit -m "feat: add backtest parameter confirmation and error feedback"
```

Expected: 回测提交体验单独可追踪。

---

## Task 4: 研究效率增强（Phase 2）

**Files:**
- Modify: `frontend/src/app/strategies/page.tsx`
- Modify: `frontend/src/app/backtest/page.tsx`
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/components/...`（如需拆分策略模板或对比视图）
- Modify: `src/main.rs`
- Modify: `src/strategy/mod.rs`

- [ ] **Step 1: 设计并实现策略模板机制**

MVP 范围内模板只需支持：
- 从内置模板快速创建
- 保存最近一次参数组合为新策略的起点

Expected: 用户无需反复从零填写同一组参数。

- [ ] **Step 2: 增加常用标的/最近使用项**

优先使用前端本地持久化或轻量后端存储，不引入复杂账户体系。

Expected: 高频研究标的可一键选取。

- [ ] **Step 3: 增加回测结果对比视图**

同一策略的多次回测至少支持比较：
- 总收益率
- 年化收益率
- 最大回撤
- Sharpe
- 胜率

Expected: 用户能快速看出参数调整是否有效。

- [ ] **Step 4: 增加报告导出**

首版可使用：
- JSON 导出
- CSV 导出
- 简版 PDF 或打印页延后

Run: `npm run type-check`
Expected: 通过。

- [ ] **Step 5: 提交阶段成果**

Run:
```bash
git add frontend/src/app/strategies/page.tsx frontend/src/app/backtest/page.tsx frontend/src/types/index.ts src/main.rs src/strategy/mod.rs
git commit -m "feat: improve research workflow efficiency"
```

Expected: Phase 2 形成独立可交付增量。

---

## Task 5: 私有部署与维护完善（Phase 4 预备）

**Files:**
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT_SOP.md`
- Modify: `scripts/deploy.sh`
- Create/Modify: `docs/...backup...md`（如有需要）

- [ ] **Step 1: 文档收敛为“私有研究 MVP”口径**

README 与部署文档应明确：
- 当前产品定位
- 主链路
- 推荐部署方式
- 常用刷新命令

- [ ] **Step 2: 定义最小备份恢复方案**

至少覆盖：
- `strategies`
- `backtest_runs`
- `orders`
- `trades`
- `performance_metrics`

- [ ] **Step 3: 补一个升级检查清单**

包括：
- 更新镜像前备份
- `refresh backend/frontend`
- 状态检查
- 健康检查
- 核心页面 smoke test

- [ ] **Step 4: 提交阶段成果**

Run:
```bash
git add README.md docs/DEPLOYMENT_SOP.md scripts/deploy.sh
git commit -m "docs: tighten private deployment workflow"
```

Expected: 私有运维流程可重复执行。

---

## Suggested Execution Order

1. Task 1: 策略主链路收尾与一致性修复
2. Task 2: 回测报告可信度增强
3. Task 3: 回测执行前的参数确认与失败反馈
4. Task 5: 私有部署与维护完善
5. Task 4: 研究效率增强

这个顺序的理由：
- 先把核心研究闭环做稳
- 再增强报告可信度
- 再补运行前确认和失败反馈
- 之后再完善部署
- 最后做效率增强，避免在不稳定主链路上继续加功能

---

## Verification Matrix

- Backend build: `cargo test --no-run`
- Frontend typing: `cd frontend && npm run type-check`
- Frontend lint: `cd frontend && npm run lint`
- Deploy backend: `./scripts/deploy.sh refresh backend`
- Deploy frontend: `./scripts/deploy.sh refresh frontend`
- Health check: `curl -fsS http://localhost:3002/health`
- Smoke flow:
  - 创建策略
  - 发起回测
  - 查看回测详情
  - 删除策略

---

## Risks

- 如果直接进入 Phase 2，会继续扩大功能表面积，导致主链路缺陷被掩盖
- 如果缺少回测与删除链路测试，后续迭代容易反复回归
- 如果部署文档不及时同步，私有运行成本会持续升高

---

## Exit Criteria

当以下条件满足时，可以宣布当前项目达到“私有部署量化研究 MVP”：
- 主链路完整稳定
- 报告语义可信
- 高优先级交互问题基本清零
- 部署与升级文档完整
- 关键路径有基础自动化校验
