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
3. Confirm the `summary` block in `/health` is populated with the restored counts you expect.
4. Open `http://localhost:3002` and confirm the core research pages load.

## Restore Notes

- Restore the tables in one shot when possible; partial restores can leave the health summary looking fine while research pages still show stale history.
- After a restore, the first `/health` call is a quick sanity check, not a substitute for opening the strategies and backtest pages.

## Temporary Rehearsal Record

Validated on 2026-04-02 14:36 CST with a temporary drill database inside the local Postgres container.

- Backup file: `/tmp/quant-restore-drill/quant_platform_mvp_20260402-restore-drill.sql`
- Schema file used for the drill: `/tmp/quant-restore-drill/quant_platform_mvp_schema_20260402.sql`
- Target database: `quant_restore_drill`
- Pre-restore row counts:
  - `strategies=1`
  - `backtest_runs=0`
  - `orders=0`
  - `trades=0`
  - `performance_metrics=0`
- Post-restore row counts:
  - `strategies=1`
  - `backtest_runs=0`
  - `orders=0`
  - `trades=0`
  - `performance_metrics=0`

Notes from the drill:

- The temporary drill restored the selected data set successfully and the restored counts matched the source counts.
- Importing only the selected table schema into an empty temporary database produced expected foreign-key warnings for `orders` and `trades` because those tables reference `portfolios`. This does not affect the documented in-place restore procedure, where the target schema already exists.
- When rehearsing into a temporary database, treat schema warnings about omitted dependencies as a sign that you are validating row-level recovery, not a full isolated environment bootstrap.
