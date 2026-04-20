use crate::error::{AppError, AppResult};
use crate::types::{
    PortfolioAssetInput, PortfolioBacktestConfigDetail, PortfolioBacktestEquityPoint,
    PortfolioBacktestHoldingRow, PortfolioBacktestRebalanceRow, PortfolioBacktestReport,
    PortfolioBacktestRunSummary, PortfolioDailyPrice,
};
use async_trait::async_trait;
use chrono::{Datelike, NaiveDate};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

fn sanitize_portfolio_asset(asset: &PortfolioAssetInput) -> PortfolioAssetInput {
    PortfolioAssetInput {
        symbol: asset.symbol.trim().to_ascii_uppercase(),
        display_name: asset.display_name.trim().to_string(),
        market: asset.market.trim().to_ascii_uppercase(),
        instrument_type: asset.instrument_type.trim().to_string(),
        target_weight: asset.target_weight,
    }
}

fn sanitize_portfolio_assets(assets: Vec<PortfolioAssetInput>) -> Vec<PortfolioAssetInput> {
    assets.into_iter().map(|asset| sanitize_portfolio_asset(&asset)).collect()
}

#[async_trait]
pub trait PortfolioPriceHistoryProvider: Send + Sync {
    async fn load_daily_prices(
        &self,
        db_pool: Option<&PgPool>,
        symbol: &str,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> AppResult<Vec<PortfolioDailyPrice>>;
}

pub struct SqlPortfolioPriceHistoryProvider;

#[async_trait]
impl PortfolioPriceHistoryProvider for SqlPortfolioPriceHistoryProvider {
    async fn load_daily_prices(
        &self,
        db_pool: Option<&PgPool>,
        symbol: &str,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> AppResult<Vec<PortfolioDailyPrice>> {
        let Some(db_pool) = db_pool else {
            return Err(AppError::internal(
                "portfolio backtest price provider requires a database pool",
            ));
        };

        let rows = sqlx::query(
            r#"
            SELECT symbol, trading_date, price
            FROM (
                SELECT DISTINCT ON ((timestamp AT TIME ZONE 'UTC')::date)
                    symbol,
                    (timestamp AT TIME ZONE 'UTC')::date AS trading_date,
                    price,
                    timestamp
                FROM market_data
                WHERE symbol = $1
                  AND (timestamp AT TIME ZONE 'UTC')::date BETWEEN $2 AND $3
                ORDER BY (timestamp AT TIME ZONE 'UTC')::date ASC, timestamp DESC
            ) daily_prices
            ORDER BY trading_date ASC
            "#,
        )
        .bind(symbol)
        .bind(start_date)
        .bind(end_date)
        .fetch_all(db_pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(PortfolioDailyPrice {
                    symbol: row.try_get("symbol")?,
                    trading_date: row.try_get("trading_date")?,
                    price: row.try_get("price")?,
                })
            })
            .collect()
    }
}

#[derive(Debug, Clone)]
struct PortfolioPositionState {
    quantity: Decimal,
}

#[derive(Debug, Clone)]
struct PortfolioSimulationContext {
    config: PortfolioBacktestConfigDetail,
    initial_capital: Decimal,
    fee_rate: Decimal,
    slippage_rate: Decimal,
}

#[derive(Debug, Clone)]
struct PortfolioSimulationResult {
    report: PortfolioBacktestReport,
    equity_curve_json: serde_json::Value,
    summary_json: serde_json::Value,
}

pub async fn run_portfolio_backtest(
    db_pool: &PgPool,
    config_id: Uuid,
) -> AppResult<PortfolioBacktestReport> {
    let config = load_portfolio_backtest_config(db_pool, config_id).await?;
    let provider = SqlPortfolioPriceHistoryProvider;
    run_portfolio_backtest_for_prices(Some(db_pool), Uuid::new_v4(), config, &provider).await
}

pub async fn run_portfolio_backtest_for_prices<P: PortfolioPriceHistoryProvider>(
    db_pool: Option<&PgPool>,
    run_id_seed: Uuid,
    config: PortfolioBacktestConfigDetail,
    provider: &P,
) -> AppResult<PortfolioBacktestReport> {
    validate_portfolio_runtime_config(&config)?;

    let run_id = if let Some(db_pool) = db_pool {
        create_portfolio_backtest_run(db_pool, run_id_seed, &config).await?
    } else {
        run_id_seed
    };

    let ctx = PortfolioSimulationContext {
        initial_capital: config.initial_capital,
        fee_rate: config.fee_bps / Decimal::from(10000u64),
        slippage_rate: config.slippage_bps / Decimal::from(10000u64),
        config: config.clone(),
    };

    let simulated = match simulate_portfolio_backtest(db_pool, run_id, ctx, provider).await {
        Ok(result) => result,
        Err(error) => {
            if let Some(db_pool) = db_pool {
                let _ = mark_portfolio_backtest_run_failed(
                    db_pool,
                    run_id,
                    &error.to_string(),
                )
                .await;
            }
            return Err(error);
        }
    };

    if let Some(db_pool) = db_pool {
        if let Err(error) = persist_portfolio_backtest_report(db_pool, &simulated).await {
            let _ = mark_portfolio_backtest_run_failed(db_pool, run_id, &error.to_string()).await;
            return Err(error);
        }

        return load_portfolio_backtest_report(db_pool, run_id).await;
    }

    Ok(simulated.report)
}

pub async fn load_portfolio_backtest_config(
    db_pool: &PgPool,
    config_id: Uuid,
) -> AppResult<PortfolioBacktestConfigDetail> {
    let row = sqlx::query(
        r#"
        SELECT
            id,
            name,
            description,
            initial_capital,
            fee_bps,
            slippage_bps,
            rebalancing_frequency,
            start_date,
            end_date,
            is_active,
            assets,
            created_at,
            updated_at
        FROM portfolio_backtest_configs
        WHERE id = $1
        "#,
    )
    .bind(config_id)
    .fetch_optional(db_pool)
    .await?;

    let Some(row) = row else {
        return Err(AppError::not_found(format!(
            "portfolio_backtest_config {}",
            config_id
        )));
    };

    let assets_value: serde_json::Value = row.try_get("assets")?;
    let assets = sanitize_portfolio_assets(serde_json::from_value(assets_value)?);

    Ok(PortfolioBacktestConfigDetail {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        initial_capital: row.try_get("initial_capital")?,
        fee_bps: row.try_get("fee_bps")?,
        slippage_bps: row.try_get("slippage_bps")?,
        rebalancing_frequency: row.try_get("rebalancing_frequency")?,
        start_date: row.try_get("start_date")?,
        end_date: row.try_get("end_date")?,
        is_active: row.try_get("is_active")?,
        assets,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub async fn load_portfolio_backtest_report(
    db_pool: &PgPool,
    run_id: Uuid,
) -> AppResult<PortfolioBacktestReport> {
    let run_row = sqlx::query(
        r#"
        SELECT id, config_id, status, started_at, completed_at, initial_capital,
               final_capital, total_return, annualized_return, max_drawdown,
               sharpe_ratio, volatility, equity_curve, summary, error_message
        FROM portfolio_backtest_runs
        WHERE id = $1
        "#,
    )
    .bind(run_id)
    .fetch_optional(db_pool)
    .await?;

    let Some(run_row) = run_row else {
        return Err(AppError::not_found(format!(
            "portfolio_backtest_run {}",
            run_id
        )));
    };

    let config_id: Uuid = run_row.try_get("config_id")?;
    let config = load_portfolio_backtest_config(db_pool, config_id).await?;
    let run = decode_portfolio_backtest_run_summary(&run_row)?;
    let equity_curve = decode_equity_curve(run_row.try_get("equity_curve")?)?;
    let holdings = load_portfolio_backtest_holdings(db_pool, run_id).await?;
    let rebalances = load_portfolio_backtest_rebalances(db_pool, run_id).await?;

    Ok(PortfolioBacktestReport {
        config,
        run,
        equity_curve,
        holdings,
        rebalances,
    })
}

async fn create_portfolio_backtest_run(
    db_pool: &PgPool,
    run_id: Uuid,
    config: &PortfolioBacktestConfigDetail,
) -> AppResult<Uuid> {
    let inserted = sqlx::query(
        r#"
        INSERT INTO portfolio_backtest_runs (
            id,
            config_id,
            status,
            initial_capital
        )
        VALUES ($1, $2, 'running', $3)
        RETURNING id
        "#,
    )
    .bind(run_id)
    .bind(config.id)
    .bind(config.initial_capital)
    .fetch_one(db_pool)
    .await?;

    Ok(inserted.try_get("id")?)
}

async fn mark_portfolio_backtest_run_failed(
    db_pool: &PgPool,
    run_id: Uuid,
    error_message: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"
        UPDATE portfolio_backtest_runs
        SET status = 'failed',
            completed_at = NOW(),
            error_message = $2
        WHERE id = $1
        "#,
    )
    .bind(run_id)
    .bind(error_message)
    .execute(db_pool)
    .await?;

    Ok(())
}

async fn persist_portfolio_backtest_report(
    db_pool: &PgPool,
    result: &PortfolioSimulationResult,
) -> AppResult<()> {
    let mut tx = db_pool.begin().await?;
    persist_portfolio_backtest_holdings(&mut tx, &result.report.holdings).await?;
    persist_portfolio_backtest_rebalances(&mut tx, &result.report.rebalances).await?;

    sqlx::query(
        r#"
        UPDATE portfolio_backtest_runs
        SET status = 'completed',
            completed_at = NOW(),
            final_capital = $2,
            total_return = $3,
            annualized_return = $4,
            max_drawdown = $5,
            sharpe_ratio = $6,
            volatility = $7,
            equity_curve = $8,
            summary = $9,
            error_message = NULL
        WHERE id = $1
        "#,
    )
    .bind(result.report.run.id)
    .bind(result.report.run.final_capital)
    .bind(result.report.run.total_return)
    .bind(result.report.run.annualized_return)
    .bind(result.report.run.max_drawdown)
    .bind(result.report.run.sharpe_ratio)
    .bind(result.report.run.volatility)
    .bind(&result.equity_curve_json)
    .bind(&result.summary_json)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(())
}

async fn persist_portfolio_backtest_holdings(
    tx: &mut Transaction<'_, Postgres>,
    holdings: &[PortfolioBacktestHoldingRow],
) -> AppResult<()> {
    for holding in holdings {
        sqlx::query(
            r#"
            INSERT INTO portfolio_backtest_holdings (
                id,
                run_id,
                symbol,
                holding_date,
                quantity,
                price,
                market_value,
                weight
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (run_id, holding_date, symbol) DO UPDATE SET
                quantity = EXCLUDED.quantity,
                price = EXCLUDED.price,
                market_value = EXCLUDED.market_value,
                weight = EXCLUDED.weight
            "#,
        )
        .bind(holding.id)
        .bind(holding.run_id)
        .bind(&holding.symbol)
        .bind(holding.holding_date)
        .bind(holding.quantity)
        .bind(holding.price)
        .bind(holding.market_value)
        .bind(holding.weight)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

async fn persist_portfolio_backtest_rebalances(
    tx: &mut Transaction<'_, Postgres>,
    rebalances: &[PortfolioBacktestRebalanceRow],
) -> AppResult<()> {
    for rebalance in rebalances {
        sqlx::query(
            r#"
            INSERT INTO portfolio_backtest_rebalances (
                id,
                run_id,
                symbol,
                rebalance_date,
                action,
                pre_weight,
                target_weight,
                post_weight,
                trade_value,
                quantity_delta,
                fee_cost,
                slippage_cost
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (run_id, rebalance_date, symbol, action) DO UPDATE SET
                pre_weight = EXCLUDED.pre_weight,
                target_weight = EXCLUDED.target_weight,
                post_weight = EXCLUDED.post_weight,
                trade_value = EXCLUDED.trade_value,
                quantity_delta = EXCLUDED.quantity_delta,
                fee_cost = EXCLUDED.fee_cost,
                slippage_cost = EXCLUDED.slippage_cost
            "#,
        )
        .bind(rebalance.id)
        .bind(rebalance.run_id)
        .bind(&rebalance.symbol)
        .bind(rebalance.rebalance_date)
        .bind(&rebalance.action)
        .bind(rebalance.pre_weight)
        .bind(rebalance.target_weight)
        .bind(rebalance.post_weight)
        .bind(rebalance.trade_value)
        .bind(rebalance.quantity_delta)
        .bind(rebalance.fee_cost)
        .bind(rebalance.slippage_cost)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

async fn load_portfolio_backtest_holdings(
    db_pool: &PgPool,
    run_id: Uuid,
) -> AppResult<Vec<PortfolioBacktestHoldingRow>> {
    let rows = sqlx::query(
        r#"
        SELECT id, run_id, symbol, holding_date, quantity, price, market_value, weight, created_at
        FROM portfolio_backtest_holdings
        WHERE run_id = $1
        ORDER BY holding_date ASC, symbol ASC
        "#,
    )
    .bind(run_id)
    .fetch_all(db_pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(PortfolioBacktestHoldingRow {
                id: row.try_get("id")?,
                run_id: row.try_get("run_id")?,
                symbol: row.try_get("symbol")?,
                holding_date: row.try_get("holding_date")?,
                quantity: row.try_get("quantity")?,
                price: row.try_get("price")?,
                market_value: row.try_get("market_value")?,
                weight: row.try_get("weight")?,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect()
}

async fn load_portfolio_backtest_rebalances(
    db_pool: &PgPool,
    run_id: Uuid,
) -> AppResult<Vec<PortfolioBacktestRebalanceRow>> {
    let rows = sqlx::query(
        r#"
        SELECT id, run_id, symbol, rebalance_date, action, pre_weight, target_weight,
               post_weight, trade_value, quantity_delta, fee_cost, slippage_cost, created_at
        FROM portfolio_backtest_rebalances
        WHERE run_id = $1
        ORDER BY rebalance_date ASC, symbol ASC, action ASC
        "#,
    )
    .bind(run_id)
    .fetch_all(db_pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(PortfolioBacktestRebalanceRow {
                id: row.try_get("id")?,
                run_id: row.try_get("run_id")?,
                symbol: row.try_get("symbol")?,
                rebalance_date: row.try_get("rebalance_date")?,
                action: row.try_get("action")?,
                pre_weight: row.try_get("pre_weight")?,
                target_weight: row.try_get("target_weight")?,
                post_weight: row.try_get("post_weight")?,
                trade_value: row.try_get("trade_value")?,
                quantity_delta: row.try_get("quantity_delta")?,
                fee_cost: row.try_get("fee_cost")?,
                slippage_cost: row.try_get("slippage_cost")?,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect()
}

async fn simulate_portfolio_backtest<P: PortfolioPriceHistoryProvider>(
    db_pool: Option<&PgPool>,
    run_id: Uuid,
    ctx: PortfolioSimulationContext,
    provider: &P,
) -> AppResult<PortfolioSimulationResult> {
    let prices_by_symbol = load_price_series(&ctx, db_pool, provider).await?;
    let aligned_dates = align_trading_dates(&prices_by_symbol)?;
    if aligned_dates.len() < 2 {
        return Err(AppError::historical_data_insufficient(
            "Portfolio backtest requires at least 2 aligned trading dates",
        ));
    }

    let mut positions: HashMap<String, PortfolioPositionState> = ctx
        .config
        .assets
        .iter()
        .map(|asset| {
            (
                asset.symbol.clone(),
                PortfolioPositionState {
                    quantity: Decimal::ZERO,
                },
            )
        })
        .collect();

    let mut cash_balance = ctx.initial_capital;
    let mut equity_curve = Vec::with_capacity(aligned_dates.len());
    let mut holdings = Vec::with_capacity(aligned_dates.len() * ctx.config.assets.len());
    let mut rebalances = Vec::new();
    let mut peak_value = Decimal::ZERO;
    let mut previous_total = None;
    let mut last_rebalance_date = None;

    for trading_date in aligned_dates {
        let current_prices = current_prices_for_date(&prices_by_symbol, trading_date)?;
        let invested_value_before_rebalance = portfolio_invested_value(&positions, &current_prices);
        let portfolio_value_before_rebalance = cash_balance + invested_value_before_rebalance;
        if should_rebalance(trading_date, last_rebalance_date, &ctx.config.rebalancing_frequency)
        {
            let current_values: HashMap<String, Decimal> = ctx
                .config
                .assets
                .iter()
                .map(|asset| {
                    let current_price = current_prices
                        .get(&asset.symbol)
                        .copied()
                        .unwrap_or(Decimal::ZERO);
                    let current_quantity = positions
                        .get(&asset.symbol)
                        .map(|position| position.quantity)
                        .unwrap_or(Decimal::ZERO);
                    (asset.symbol.clone(), current_quantity * current_price)
                })
                .collect();

            let provisional_total_cost: Decimal = ctx
                .config
                .assets
                .iter()
                .map(|asset| {
                    let current_value = current_values
                        .get(&asset.symbol)
                        .copied()
                        .unwrap_or(Decimal::ZERO);
                    let provisional_target = portfolio_value_before_rebalance * asset.target_weight;
                    (provisional_target - current_value).abs() * (ctx.fee_rate + ctx.slippage_rate)
                })
                .sum();

            let investable_value = (portfolio_value_before_rebalance - provisional_total_cost)
                .max(Decimal::ZERO);

            let mut rebalance_rows = Vec::new();
            let mut total_cost = Decimal::ZERO;
            for asset in &ctx.config.assets {
                let current_price = current_prices.get(&asset.symbol).ok_or_else(|| {
                    AppError::historical_data_insufficient(format!(
                        "Missing historical data for {} on {}",
                        asset.symbol, trading_date
                    ))
                })?;
                let current_value = current_values
                    .get(&asset.symbol)
                    .copied()
                    .unwrap_or(Decimal::ZERO);
                let target_value = investable_value * asset.target_weight;
                let trade_value = target_value - current_value;
                let quantity_delta = if *current_price > Decimal::ZERO {
                    trade_value / *current_price
                } else {
                    Decimal::ZERO
                };
                let fee_cost = trade_value.abs() * ctx.fee_rate;
                let slippage_cost = trade_value.abs() * ctx.slippage_rate;
                total_cost += fee_cost + slippage_cost;

                positions.insert(
                    asset.symbol.clone(),
                    PortfolioPositionState {
                        quantity: if *current_price > Decimal::ZERO {
                            target_value / *current_price
                        } else {
                            Decimal::ZERO
                        },
                    },
                );

                let pre_weight = if portfolio_value_before_rebalance > Decimal::ZERO {
                    current_value / portfolio_value_before_rebalance
                } else {
                    Decimal::ZERO
                };
                let action = if trade_value > Decimal::ZERO {
                    "buy"
                } else if trade_value < Decimal::ZERO {
                    "sell"
                } else {
                    "hold"
                };

                rebalance_rows.push(PortfolioBacktestRebalanceRow {
                    id: Uuid::new_v4(),
                    run_id,
                    symbol: asset.symbol.clone(),
                    rebalance_date: trading_date,
                    action: action.to_string(),
                    pre_weight,
                    target_weight: asset.target_weight,
                    post_weight: Decimal::ZERO,
                    trade_value,
                    quantity_delta,
                    fee_cost,
                    slippage_cost,
                    created_at: chrono::Utc::now(),
                });
            }

            cash_balance = portfolio_value_before_rebalance - investable_value - total_cost;
            let total_value_after_rebalance = investable_value + cash_balance;
            let mut finalized_rows = Vec::with_capacity(rebalance_rows.len());
            for mut row in rebalance_rows {
                let current_price = current_prices.get(&row.symbol).ok_or_else(|| {
                    AppError::historical_data_insufficient(format!(
                        "Missing historical data for {} on {}",
                        row.symbol, trading_date
                    ))
                })?;
                let target_value = investable_value * row.target_weight;
                row.post_weight = if total_value_after_rebalance > Decimal::ZERO {
                    target_value / total_value_after_rebalance
                } else {
                    Decimal::ZERO
                };
                row.quantity_delta = if *current_price > Decimal::ZERO {
                    row.trade_value / *current_price
                } else {
                    Decimal::ZERO
                };
                finalized_rows.push(row);
            }
            rebalances.extend(finalized_rows);
            last_rebalance_date = Some(trading_date);
        }

        let invested_value = portfolio_invested_value(&positions, &current_prices);
        let total_value = cash_balance + invested_value;
        peak_value = peak_value.max(total_value);
        let drawdown = if peak_value > Decimal::ZERO {
            Some((peak_value - total_value) / peak_value)
        } else {
            None
        };
        let daily_return = previous_total.and_then(|prev| {
            if prev > Decimal::ZERO {
                Some((total_value / prev) - Decimal::ONE)
            } else {
                None
            }
        });
        previous_total = Some(total_value);

        holdings.extend(build_holdings_rows(
            run_id,
            trading_date,
            &positions,
            &current_prices,
            total_value,
        ));

        equity_curve.push(PortfolioBacktestEquityPoint {
            trading_date,
            total_value,
            cash_balance,
            invested_value,
            daily_return,
            drawdown,
        });
    }

    let report = build_portfolio_backtest_report(
        run_id,
        ctx.config.clone(),
        equity_curve.clone(),
        holdings,
        rebalances,
        ctx.initial_capital,
    )?;

    let equity_curve_json = serde_json::to_value(&equity_curve)?;
    let summary_json = serde_json::to_value(json!({
        "aligned_dates": report.equity_curve.len(),
        "asset_count": report.config.assets.len(),
        "rebalancing_frequency": report.config.rebalancing_frequency,
        "initial_capital": report.run.initial_capital,
        "final_capital": report.run.final_capital,
        "total_return": report.run.total_return,
        "annualized_return": report.run.annualized_return,
        "max_drawdown": report.run.max_drawdown,
        "sharpe_ratio": report.run.sharpe_ratio,
        "volatility": report.run.volatility,
    }))?;

    Ok(PortfolioSimulationResult {
        report,
        equity_curve_json,
        summary_json,
    })
}

fn build_portfolio_backtest_report(
    run_id: Uuid,
    config: PortfolioBacktestConfigDetail,
    equity_curve: Vec<PortfolioBacktestEquityPoint>,
    holdings: Vec<PortfolioBacktestHoldingRow>,
    rebalances: Vec<PortfolioBacktestRebalanceRow>,
    initial_capital: Decimal,
) -> AppResult<PortfolioBacktestReport> {
    let final_point = equity_curve
        .last()
        .ok_or_else(|| AppError::internal("equity curve is empty"))?;
    let final_capital = final_point.total_value;
    let config_id = config.id;
    let now = chrono::Utc::now();
    let total_return = if initial_capital > Decimal::ZERO {
        Some((final_capital / initial_capital) - Decimal::ONE)
    } else {
        None
    };
    let annualized_return = calculate_annualized_return(
        initial_capital,
        final_capital,
        equity_curve.first().map(|point| point.trading_date),
        equity_curve.last().map(|point| point.trading_date),
    );
    let daily_returns: Vec<f64> = equity_curve
        .iter()
        .filter_map(|point| point.daily_return.and_then(|value| value.to_f64()))
        .collect();
    let volatility = annualized_volatility(&daily_returns);
    let sharpe_ratio = annualized_sharpe_ratio(&daily_returns);
    let max_drawdown = equity_curve
        .iter()
        .filter_map(|point| point.drawdown.and_then(|value| value.to_f64()))
        .fold(0.0_f64, f64::max);

    Ok(PortfolioBacktestReport {
        config,
        run: PortfolioBacktestRunSummary {
            id: run_id,
            config_id,
            status: "completed".to_string(),
            started_at: now,
            completed_at: Some(now),
            initial_capital,
            final_capital: Some(final_capital),
            total_return,
            annualized_return,
            max_drawdown: Some(Decimal::from_f64(max_drawdown).unwrap_or(Decimal::ZERO)),
            sharpe_ratio: Some(Decimal::from_f64(sharpe_ratio).unwrap_or(Decimal::ZERO)),
            volatility: Some(Decimal::from_f64(volatility).unwrap_or(Decimal::ZERO)),
            summary: None,
            error_message: None,
        },
        equity_curve,
        holdings,
        rebalances,
    })
}

async fn load_price_series<P: PortfolioPriceHistoryProvider>(
    ctx: &PortfolioSimulationContext,
    db_pool: Option<&PgPool>,
    provider: &P,
) -> AppResult<HashMap<String, HashMap<NaiveDate, Decimal>>> {
    let mut by_symbol = HashMap::new();
    for asset in &ctx.config.assets {
        let prices = provider
            .load_daily_prices(db_pool, &asset.symbol, ctx.config.start_date, ctx.config.end_date)
            .await?;
        if prices.is_empty() {
            return Err(AppError::historical_data_insufficient(format!(
                "Missing historical data for {}",
                asset.symbol
            )));
        }

        by_symbol.insert(
            asset.symbol.clone(),
            prices
                .into_iter()
                .map(|point| (point.trading_date, point.price))
                .collect(),
        );
    }

    Ok(by_symbol)
}

fn align_trading_dates(
    prices_by_symbol: &HashMap<String, HashMap<NaiveDate, Decimal>>,
) -> AppResult<Vec<NaiveDate>> {
    let mut iter = prices_by_symbol.values();
    let Some(first) = iter.next() else {
        return Err(AppError::historical_data_insufficient(
            "No portfolio price history loaded",
        ));
    };

    let mut common: BTreeSet<NaiveDate> = first.keys().copied().collect();
    for series in iter {
        common.retain(|date| series.contains_key(date));
    }

    if common.is_empty() {
        return Err(AppError::historical_data_insufficient(
            "No aligned trading dates available across portfolio assets",
        ));
    }

    Ok(common.into_iter().collect())
}

fn validate_portfolio_runtime_config(config: &PortfolioBacktestConfigDetail) -> AppResult<()> {
    let markets = config
        .assets
        .iter()
        .map(|asset| asset.market.as_str())
        .collect::<BTreeSet<_>>();

    if markets.len() > 1 {
        return Err(AppError::validation(
            "Portfolio backtest v1 requires all assets to be in the same market",
        ));
    }

    Ok(())
}

fn current_prices_for_date(
    prices_by_symbol: &HashMap<String, HashMap<NaiveDate, Decimal>>,
    trading_date: NaiveDate,
) -> AppResult<HashMap<String, Decimal>> {
    let mut current_prices = HashMap::new();
    for (symbol, series) in prices_by_symbol {
        let price = series.get(&trading_date).copied().ok_or_else(|| {
            AppError::historical_data_insufficient(format!(
                "Missing historical data for {} on {}",
                symbol, trading_date
            ))
        })?;
        current_prices.insert(symbol.clone(), price);
    }
    Ok(current_prices)
}

fn portfolio_invested_value(
    positions: &HashMap<String, PortfolioPositionState>,
    current_prices: &HashMap<String, Decimal>,
) -> Decimal {
    positions
        .iter()
        .map(|(symbol, position)| {
            position.quantity * current_prices.get(symbol).copied().unwrap_or(Decimal::ZERO)
        })
        .sum()
}

fn build_holdings_rows(
    run_id: Uuid,
    holding_date: NaiveDate,
    positions: &HashMap<String, PortfolioPositionState>,
    current_prices: &HashMap<String, Decimal>,
    total_value: Decimal,
) -> Vec<PortfolioBacktestHoldingRow> {
    positions
        .iter()
        .map(|(symbol, position)| {
            let price = current_prices.get(symbol).copied().unwrap_or(Decimal::ZERO);
            let market_value = position.quantity * price;
            let weight = if total_value > Decimal::ZERO {
                market_value / total_value
            } else {
                Decimal::ZERO
            };

            PortfolioBacktestHoldingRow {
                id: Uuid::new_v4(),
                run_id,
                symbol: symbol.clone(),
                holding_date,
                quantity: position.quantity,
                price,
                market_value,
                weight,
                created_at: chrono::Utc::now(),
            }
        })
        .collect()
}

fn should_rebalance(
    trading_date: NaiveDate,
    last_rebalance_date: Option<NaiveDate>,
    frequency: &str,
) -> bool {
    match last_rebalance_date {
        None => true,
        Some(last) => match frequency {
            "daily" => true,
            "weekly" => trading_date.iso_week() != last.iso_week(),
            "monthly" => {
                trading_date.year() != last.year() || trading_date.month() != last.month()
            }
            _ => false,
        },
    }
}

fn calculate_annualized_return(
    initial_capital: Decimal,
    final_capital: Decimal,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
) -> Option<Decimal> {
    let (Some(start_date), Some(end_date)) = (start_date, end_date) else {
        return None;
    };
    if initial_capital <= Decimal::ZERO {
        return None;
    }

    let holding_days = (end_date - start_date).num_days().max(1) as f64;
    let total_return = final_capital.to_f64()? / initial_capital.to_f64()? - 1.0;
    let annualized = (1.0 + total_return).powf(365.0 / holding_days) - 1.0;
    Decimal::from_f64(annualized)
}

fn annualized_volatility(daily_returns: &[f64]) -> f64 {
    if daily_returns.len() < 2 {
        return 0.0;
    }
    let mean = daily_returns.iter().sum::<f64>() / daily_returns.len() as f64;
    let variance = daily_returns
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / (daily_returns.len() as f64 - 1.0);
    variance.sqrt() * 252.0_f64.sqrt()
}

fn annualized_sharpe_ratio(daily_returns: &[f64]) -> f64 {
    if daily_returns.len() < 2 {
        return 0.0;
    }
    let mean = daily_returns.iter().sum::<f64>() / daily_returns.len() as f64;
    let variance = daily_returns
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / (daily_returns.len() as f64 - 1.0);
    let std_dev = variance.sqrt();
    if std_dev == 0.0 {
        0.0
    } else {
        (mean / std_dev) * 252.0_f64.sqrt()
    }
}

fn decode_portfolio_backtest_run_summary(
    row: &sqlx::postgres::PgRow,
) -> AppResult<PortfolioBacktestRunSummary> {
    Ok(PortfolioBacktestRunSummary {
        id: row.try_get("id")?,
        config_id: row.try_get("config_id")?,
        status: row.try_get("status")?,
        started_at: row.try_get("started_at")?,
        completed_at: row.try_get("completed_at")?,
        initial_capital: row.try_get("initial_capital")?,
        final_capital: row.try_get("final_capital")?,
        total_return: row.try_get("total_return")?,
        annualized_return: row.try_get("annualized_return")?,
        max_drawdown: row.try_get("max_drawdown")?,
        sharpe_ratio: row.try_get("sharpe_ratio")?,
        volatility: row.try_get("volatility")?,
        summary: row.try_get("summary")?,
        error_message: row.try_get("error_message")?,
    })
}

fn decode_equity_curve(value: Option<serde_json::Value>) -> AppResult<Vec<PortfolioBacktestEquityPoint>> {
    match value {
        Some(value) => Ok(serde_json::from_value(value)?),
        None => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use rust_decimal::Decimal;
    use std::collections::HashMap;

    #[derive(Clone, Default)]
    struct MockHistoryProvider {
        series: HashMap<String, Vec<(NaiveDate, Decimal)>>,
    }

    impl MockHistoryProvider {
        fn with_series(mut self, symbol: &str, series: Vec<(NaiveDate, Decimal)>) -> Self {
            self.series.insert(symbol.to_string(), series);
            self
        }
    }

    #[async_trait]
    impl PortfolioPriceHistoryProvider for MockHistoryProvider {
        async fn load_daily_prices(
            &self,
            _db_pool: Option<&PgPool>,
            symbol: &str,
            _start_date: NaiveDate,
            _end_date: NaiveDate,
        ) -> AppResult<Vec<PortfolioDailyPrice>> {
            Ok(self
                .series
                .get(symbol)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|(trading_date, price)| PortfolioDailyPrice {
                    symbol: symbol.to_string(),
                    trading_date,
                    price,
                })
                .collect())
        }
    }

    fn detail_config(frequency: &str) -> PortfolioBacktestConfigDetail {
        PortfolioBacktestConfigDetail {
            id: Uuid::new_v4(),
            name: format!("test-{frequency}"),
            description: None,
            initial_capital: Decimal::new(100000, 0),
            fee_bps: Decimal::new(5, 0),
            slippage_bps: Decimal::new(2, 0),
            rebalancing_frequency: frequency.to_string(),
            start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 1, 10).unwrap(),
            is_active: true,
            assets: vec![
                crate::types::PortfolioAssetInput {
                    symbol: "AAPL".to_string(),
                    display_name: "Apple".to_string(),
                    market: "US".to_string(),
                    instrument_type: "Common Stock".to_string(),
                    target_weight: Decimal::new(6, 1),
                },
                crate::types::PortfolioAssetInput {
                    symbol: "MSFT".to_string(),
                    display_name: "Microsoft".to_string(),
                    market: "US".to_string(),
                    instrument_type: "Common Stock".to_string(),
                    target_weight: Decimal::new(4, 1),
                },
            ],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[tokio::test]
    async fn portfolio_backtest_two_asset_daily_rebalance_success() {
        let provider = MockHistoryProvider::default()
            .with_series(
                "AAPL",
                vec![
                    (NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), Decimal::new(100, 0)),
                    (NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(), Decimal::new(102, 0)),
                    (NaiveDate::from_ymd_opt(2026, 1, 3).unwrap(), Decimal::new(104, 0)),
                ],
            )
            .with_series(
                "MSFT",
                vec![
                    (NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), Decimal::new(200, 0)),
                    (NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(), Decimal::new(198, 0)),
                    (NaiveDate::from_ymd_opt(2026, 1, 3).unwrap(), Decimal::new(202, 0)),
                ],
            );

        let report = run_portfolio_backtest_for_prices(None, Uuid::new_v4(), detail_config("daily"), &provider)
            .await
            .expect("daily backtest should succeed");

        assert!(report.run.final_capital.is_some());
        assert!(!report.equity_curve.is_empty());
        assert!(!report.rebalances.is_empty());
        assert_eq!(report.run.status, "completed");
    }

    #[tokio::test]
    async fn portfolio_backtest_weekly_rebalance_path_uses_fewer_rebalances() {
        let provider = MockHistoryProvider::default()
            .with_series(
                "AAPL",
                vec![
                    (NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), Decimal::new(100, 0)),
                    (NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(), Decimal::new(101, 0)),
                    (NaiveDate::from_ymd_opt(2026, 1, 8).unwrap(), Decimal::new(103, 0)),
                ],
            )
            .with_series(
                "MSFT",
                vec![
                    (NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), Decimal::new(200, 0)),
                    (NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(), Decimal::new(199, 0)),
                    (NaiveDate::from_ymd_opt(2026, 1, 8).unwrap(), Decimal::new(201, 0)),
                ],
            );

        let report = run_portfolio_backtest_for_prices(None, Uuid::new_v4(), detail_config("weekly"), &provider)
            .await
            .expect("weekly backtest should succeed");

        assert_eq!(report.run.status, "completed");
        assert!(report.rebalances.len() <= 4);
    }

    #[tokio::test]
    async fn portfolio_backtest_missing_history_returns_error() {
        let provider = MockHistoryProvider::default().with_series(
            "AAPL",
            vec![
                (NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), Decimal::new(100, 0)),
                (NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(), Decimal::new(101, 0)),
            ],
        );

        let err = run_portfolio_backtest_for_prices(None, Uuid::new_v4(), detail_config("daily"), &provider)
            .await
            .expect_err("missing history should fail");

        assert!(err.to_string().contains("historical data"));
    }

    #[tokio::test]
    async fn portfolio_backtest_rejects_mixed_market_runtime_config() {
        let provider = MockHistoryProvider::default();
        let mut config = detail_config("daily");
        config.assets[1].market = "HK".to_string();
        config.assets[1].symbol = "0700.HK".to_string();

        let err = run_portfolio_backtest_for_prices(None, Uuid::new_v4(), config, &provider)
            .await
            .expect_err("mixed markets should be rejected");

        assert!(err.to_string().contains("same market"));
    }
}
