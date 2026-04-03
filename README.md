# HK/US Quant Private Research MVP

This is a self-hosted private quant research MVP. It is intentionally narrow: create a strategy, run a backtest, inspect the report, and keep the stack maintainable for private use.

## Current Scope
- Strategy creation, editing, and deletion
- Backtest execution and report review
- Orders, trades, and performance history
- Private deployment, refresh, and recovery workflows

## Main Flow
1. Create or edit a strategy in the web UI.
2. Run a backtest from that strategy.
3. Review the latest report and compare results.
4. Use the deployment SOP when you update the stack.

## Stack
- Rust backend with Postgres and Redis
- Next.js frontend
- Docker Compose deployment behind Nginx

## Quick Start
### Requirements
- Rust stable
- Node.js 18+
- Docker
- Docker Compose v2

### Environment
- `DATABASE_URL` and `REDIS_URL` are required. `./scripts/deploy.sh up ...` checks them before startup.
- `TWELVE_DATA_API_KEY` is only needed for Twelve Data search/list flows or explicit use of that data source.
- `ALLOW_MOCK_MARKET_DATA=false` is the default. Set it to `true` only if you want fallback demo data.

### Recommended Deployment
```bash
./scripts/deploy.sh up --build
```

### Common Maintenance Commands
```bash
./scripts/deploy.sh refresh backend
./scripts/deploy.sh refresh frontend
./scripts/deploy.sh status
./scripts/deploy.sh logs
```

### Stop or Reset
```bash
./scripts/deploy.sh down
./scripts/deploy.sh destroy
```

### Local URLs
```text
App: http://localhost:3002
Health: http://localhost:3002/health
```

`/health` now includes a lightweight operational summary with recent strategy, order, backtest, and trade counts so you can spot an empty or stale stack quickly. If the summary cannot be collected, the endpoint reports `warning` instead of a false green.

You can change the host port with `./scripts/deploy.sh up --port <port>`, for example `./scripts/deploy.sh up --port 4000`.
If you only need to rebuild one service, use `./scripts/deploy.sh build backend` or `./scripts/deploy.sh up --build --service frontend`.

Deployment, upgrade, and backup details live in [docs/DEPLOYMENT_SOP.md](docs/DEPLOYMENT_SOP.md) and [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md).

## API Notes
The containerized entrypoint serves the app at `http://localhost:3002` and exposes the API under `/api/v1`.

### WebSocket
The `/ws` endpoint is mounted in the containerized stack. The market page prefers it for live updates and falls back to HTTP polling if the socket drops.

```text
ws://localhost:3002/ws
```

Messages:
- `MarketData`
- `Signal`
- `OrderUpdate`
- `PortfolioUpdate`

The market data API distinguishes `live`, `degraded`, and `error` states, and the UI shows the data source explicitly.

## Testing
```bash
RUN_E2E_TESTS=1 cargo test
cd frontend && npm run test:smoke
```
