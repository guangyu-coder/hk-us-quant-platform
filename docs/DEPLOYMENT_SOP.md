# Deployment SOP

## Scope

This project is deployed only through the containerized entrypoint:

```bash
./scripts/deploy.sh
```

The script wraps `docker compose` and manages the full stack defined in [docker-compose.yml](/Users/liguangyu/githubProj/hk-us-quant-platform/docker-compose.yml):
- `postgres`
- `redis`
- `backend`
- `frontend`
- `nginx`
- optional `prometheus` and `grafana` via profile

## Prerequisites

Before deployment, confirm:

1. Docker Desktop or Docker Engine is running.
2. Docker Compose v2 is available through `docker compose`.
3. Port `3002` is free, or choose another port with `--port`.
4. The repository root contains `.env`.
   If it does not exist, `./scripts/deploy.sh up ...` will create it from `.env.example`.
5. `.env` contains non-empty `DATABASE_URL` and `REDIS_URL`.
6. If you want demo fallback quotes/history, set `ALLOW_MOCK_MARKET_DATA=true`. Default is `false`.

## Standard Deployment

Recommended command:

```bash
./scripts/deploy.sh up --build
```

What this does:

1. Checks Docker availability.
2. Creates `.env` from `.env.example` if needed.
3. Validates required env values before startup.
4. Fails early if the requested public port is already in use.
5. Builds images when `--build` is passed.
6. Starts the compose stack in the background.
7. Waits for the public health endpoint to return success.
8. Prints the final service status.

## Deployment With Custom Port

Default public port is `3002`.

To bind the stack to another port:

```bash
./scripts/deploy.sh up --build --port 4000
```

After that:
- App URL: `http://localhost:4000`
- Health URL: `http://localhost:4000/health`

## Deployment With Observability

To start Prometheus and Grafana as well:

```bash
./scripts/deploy.sh up --build --observability
```

This enables the `observability` compose profile in addition to the core services.

## Targeted Rebuilds

When only one service changed, avoid rebuilding the whole stack.

Build one service image only:

```bash
./scripts/deploy.sh build backend
./scripts/deploy.sh build frontend
```

Start or rebuild one service only:

```bash
./scripts/deploy.sh up --service backend
./scripts/deploy.sh up --build --service frontend
```

Restart one service only:

```bash
./scripts/deploy.sh restart backend
./scripts/deploy.sh restart frontend
```

Fastest replace-in-place workflow for an already running stack:

```bash
./scripts/deploy.sh refresh backend
./scripts/deploy.sh refresh frontend
```

`refresh` rebuilds and recreates only the named service with `--no-deps`, so it does not restart `postgres`, `redis`, or `nginx`.

## Verification Checklist

After deployment, verify:

1. Service status:

```bash
./scripts/deploy.sh status
```

2. Public health endpoint:

```bash
curl http://localhost:3002/health
```

If a custom port was used, replace `3002` with that port.

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
