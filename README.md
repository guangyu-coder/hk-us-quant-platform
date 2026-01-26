# HK/US Quant Trading Platform

全栈量化交易平台原型：Rust 后端（API + Service 分层 + Postgres/Redis + 事件总线）与 Next.js 前端仪表盘。仓库内保留了一套早期 Python 框架骨架，但 `main.py` 目前仍是占位入口。

## 目录结构（主线）
- `src/`: Rust 后端（Axum + sqlx + Redis Streams）
- `frontend/`: Next.js 前端（axios 调用后端 `/api/v1/*`）
- `migrations/`: Postgres/TimescaleDB schema
- `scripts/market_data.py`: 实时行情脚本（后端 `/api/v1/market-data/:symbol` 调用）
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

## API 说明（与前端对齐）
后端基路径为 `http://localhost:8080`，API 前缀为 `/api/v1`，前端开发态默认请求 `http://localhost:8080/api/v1/*`。

## 测试
仓库内包含一条可选的 HTTP 端到端冒烟测试（需要本机可连接 Postgres/Redis，且会自动运行 migrations）：
```bash
RUN_E2E_TESTS=1 cargo test
```
