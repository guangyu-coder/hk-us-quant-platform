# HK/US Quant Trading Platform

全栈量化交易平台原型：Rust 后端（API + Service 分层 + Postgres/Redis + 事件总线）与 Next.js 前端仪表盘。

## ✨ 功能特性

### 策略模块
- **SMA 策略** - 简单移动平均线
- **RSI 策略** - 相对强弱指数（超买超卖）
- **MACD 策略** - 指数平滑异同移动平均线
- **布林带策略** - Bollinger Bands 通道突破
- **双均线交叉** - 金叉死叉信号

### 技术指标库
- SMA / EMA
- RSI
- MACD (快线、慢线、柱状图)
- Bollinger Bands (%B, 带宽)
- ATR (平均真实范围)
- Stochastic Oscillator

### 券商集成
- **Alpaca** - 美股 Paper/Live 交易 API
- **Mock Broker** - 本地模拟交易

### 实时通讯
- WebSocket 推送（行情、信号、订单状态、持仓）
- 心跳保活机制

## 目录结构
- `src/`: Rust 后端（Axum + sqlx + Redis Streams）
- `src/strategy/`: 策略引擎 + 技术指标
- `src/broker/`: 券商 API 集成
- `src/websocket.rs`: WebSocket 实时推送
- `frontend/`: Next.js 前端（axios 调用后端 `/api/v1/*`）
- `migrations/`: Postgres/TimescaleDB schema
- `scripts/market_data.py`: 实时行情脚本
- `docker-compose.yml`: Postgres/Redis/Nginx/Prometheus/Grafana

## 快速开始
### 依赖
- Rust（stable）
- Node.js 18+
- Docker
- Docker Compose v2

### 环境变量
- `DATABASE_URL` 和 `REDIS_URL` 为必填；`./scripts/deploy.sh up ...` 会在启动前校验。
- `TWELVE_DATA_API_KEY` 仅在 Twelve Data 搜索/列表或显式使用该数据源时需要。
- `ALLOW_MOCK_MARKET_DATA=false` 为默认值；若希望上游失败时回退到演示数据，可显式设为 `true`。

### 容器化部署
```bash
./scripts/deploy.sh up --build
```

### 停止部署
```bash
./scripts/deploy.sh down
```

### 删除部署和数据卷
```bash
./scripts/deploy.sh destroy
```

### 查看状态
```bash
./scripts/deploy.sh status
```

### 查看日志
```bash
./scripts/deploy.sh logs
./scripts/deploy.sh logs backend
```

### 本地访问
```text
首页: http://localhost:3002
健康检查: http://localhost:3002/health
```

可通过 `./scripts/deploy.sh up --port <port>` 覆盖默认端口，例如 `./scripts/deploy.sh up --port 4000`。
如果只想重建单个服务，可用 `./scripts/deploy.sh build backend` 或 `./scripts/deploy.sh up --build --service frontend`。
如果服务已经在运行，最快的局部更新方式是 `./scripts/deploy.sh refresh backend` 或 `./scripts/deploy.sh refresh frontend`。

完整部署流程见 [docs/DEPLOYMENT_SOP.md](/Users/liguangyu/githubProj/hk-us-quant-platform/docs/DEPLOYMENT_SOP.md)。

## API 说明
容器化部署下，对外入口为 `http://localhost:3002`，API 前缀为 `/api/v1`。

### WebSocket
默认容器化入口已挂载 `/ws`，市场页会优先使用该连接接收行情推送，断开时退回 HTTP 轮询。
```
ws://localhost:3002/ws
```

消息类型：
- `MarketData` - 实时行情
- `Signal` - 策略信号
- `OrderUpdate` - 订单状态
- `PortfolioUpdate` - 持仓变动

市场数据接口现在区分 `live`、`degraded`、`error` 三种状态；前端会显式显示降级数据源，而不是静默伪装为实时数据。

## 测试
```bash
RUN_E2E_TESTS=1 cargo test
```
