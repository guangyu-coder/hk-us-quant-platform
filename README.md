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

## 快速开始（开发态）
### 依赖
- Rust（stable）
- Node.js 18+
- Docker（用于 Postgres/Redis）

### 启动基础设施
```bash
docker compose up -d
```

### 启动后端
```bash
cargo run
```

### 启动前端
```bash
cd frontend
npm install
npm run dev
```

### 配置 Alpaca（可选）
```bash
cp .env.example .env
# 编辑 .env 填入 Alpaca API Key
```

## API 说明
后端基路径为 `http://localhost:8080`，API 前缀为 `/api/v1`。

### WebSocket
```
ws://localhost:8080/ws
```

消息类型：
- `MarketData` - 实时行情
- `Signal` - 策略信号
- `OrderUpdate` - 订单状态
- `PortfolioUpdate` - 持仓变动

## 测试
```bash
RUN_E2E_TESTS=1 cargo test
```
