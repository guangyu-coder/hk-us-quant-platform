# Deployment SOP

## Scope

This project is operated as a private research MVP and is deployed through the containerized entrypoint only:

```bash
./scripts/deploy.sh
```

The script wraps `docker compose` and manages the full stack defined in [docker-compose.yml](../docker-compose.yml):
- `postgres`
- `redis`
- `backend`
- `frontend`
- `nginx`
- optional `prometheus` and `grafana` via profile

For data backup and restore, see [docs/BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Prerequisites

Before deployment or update, confirm:

1. Docker Desktop or Docker Engine is running.
2. Docker Compose v2 is available through `docker compose`.
3. Port `3002` is free, or you plan to use `--port`.
4. The repository root contains `.env`.
5. `.env` contains non-empty `DATABASE_URL` and `REDIS_URL`.
6. `ALLOW_MOCK_MARKET_DATA=true` is only set when you intentionally want fallback demo data.

## Recommended Deployment

Use this for a fresh start or a full rebuild:

```bash
./scripts/deploy.sh up --build
```

This command:

1. Checks Docker availability.
2. Creates `.env` from `.env.example` if needed.
3. Validates required env values before startup.
4. Fails early if the requested public port is already in use.
5. Builds images when `--build` is passed.
6. Starts the compose stack in the background.
7. Waits for the public health endpoint to return success.
8. Prints the final service status.

## Routine Update Path

Use targeted refreshes when only backend or frontend changed:

```bash
./scripts/deploy.sh refresh backend
./scripts/deploy.sh refresh frontend
```

`refresh` rebuilds and recreates only the named service with `--no-deps`, so it does not restart `postgres`, `redis`, or `nginx`.

If you want to rebuild images without recreating containers, use:

```bash
./scripts/deploy.sh build backend
./scripts/deploy.sh build frontend
```

## Upgrade Checklist

Before an update:

1. Back up the data you care about. The minimal backup set is documented in [docs/BACKUP_RESTORE.md](BACKUP_RESTORE.md).
2. Refresh the changed services.
3. Check service status.
4. Run a health check.
5. Smoke test the main page and the core research flow.

Suggested command sequence:

```bash
./scripts/deploy.sh refresh backend
./scripts/deploy.sh refresh frontend
./scripts/deploy.sh status
curl -fsS http://localhost:3002/health
```

If you used a custom port, replace `3002` with that port.

Smoke test the core page:

1. Open `http://localhost:3002`.
2. Confirm the strategies page loads.
3. Create or open a strategy.
4. Run a backtest.
5. Open the latest backtest report.

## Verification Checklist

After deployment or update, verify:

1. Service status:

```bash
./scripts/deploy.sh status
```

2. Public health endpoint:

```bash
curl -fsS http://localhost:3002/health
```

The health payload includes a small `summary` block with recent strategy, order, backtest, and trade counts. If those numbers are unexpectedly zero after a deploy, or the endpoint falls back to `warning`, treat it as a signal to inspect the backing data tables before assuming the stack is healthy.

3. Main entrypoint:

Open `http://localhost:3002` in the browser.

## Logs And Troubleshooting

View all logs:

```bash
./scripts/deploy.sh logs
```

View one service only:

```bash
./scripts/deploy.sh logs backend
./scripts/deploy.sh logs frontend
./scripts/deploy.sh logs nginx
```

Typical checks:
- `backend` for migration or startup failures
- `frontend` for Next.js startup errors
- `nginx` for routing or reverse proxy issues
- `postgres` and `redis` health in `./scripts/deploy.sh status`

## Stop Procedure

Stop containers and keep data volumes:

```bash
./scripts/deploy.sh down
```

Use this for normal shutdown.

## Full Cleanup Procedure

Stop containers and remove volumes:

```bash
./scripts/deploy.sh destroy
```

Use this only when you want a clean data reset.

## Current Command Reference

```bash
./scripts/deploy.sh up
./scripts/deploy.sh up --build
./scripts/deploy.sh up --build --port 4000
./scripts/deploy.sh up --build --observability
./scripts/deploy.sh up --build --service backend
./scripts/deploy.sh build
./scripts/deploy.sh build frontend
./scripts/deploy.sh restart
./scripts/deploy.sh restart backend
./scripts/deploy.sh refresh backend
./scripts/deploy.sh refresh frontend
./scripts/deploy.sh status
./scripts/deploy.sh logs
./scripts/deploy.sh logs backend
./scripts/deploy.sh down
./scripts/deploy.sh destroy
```
