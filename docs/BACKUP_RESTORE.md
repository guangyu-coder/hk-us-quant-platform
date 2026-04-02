# Backup And Restore

This is the minimal manual backup plan for the private research MVP. It keeps the tables that matter for day-to-day research and recovery:

- `strategies`
- `backtest_runs`
- `orders`
- `trades`
- `performance_metrics`

`backtest_runs` already stores the backtest trades and performance metrics snapshot, so the dump covers both the run summary and the detailed result payload.

## Backup

Run from the repository root while the Postgres container is healthy:

```bash
mkdir -p backups
docker compose exec -T postgres \
  pg_dump -U postgres -d quant_platform \
  --data-only --column-inserts \
  --table=strategies \
  --table=backtest_runs \
  --table=orders \
  --table=trades \
  --table=performance_metrics \
  > "backups/quant_platform_mvp_$(date +%Y%m%d-%H%M%S).sql"
```

This is intentionally simple and easy to run before a service refresh or version update.

## Restore

For a fresh restore into the same schema:

```bash
cat backups/quant_platform_mvp_YYYYMMDD-HHMMSS.sql | \
  docker compose exec -T postgres psql -U postgres -d quant_platform
```

If the target tables already contain rows, clear them first in dependency order:

```bash
docker compose exec -T postgres psql -U postgres -d quant_platform -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE backtest_runs, trades, orders, performance_metrics, strategies RESTART IDENTITY CASCADE;"
```

Then run the restore command above.

## After Restore

1. Check service status with `./scripts/deploy.sh status`.
2. Verify the health endpoint with `curl -fsS http://localhost:3002/health`.
3. Open `http://localhost:3002` and confirm the core research pages load.
