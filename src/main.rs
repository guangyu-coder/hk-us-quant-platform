use anyhow::Result;
use axum::{
    extract::Path,
    extract::Query,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::sync::OnceLock;
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{info, warn};

mod broker;
mod config;
mod data;
mod error;
mod events;
mod execution;
mod market_data;
mod portfolio;
mod risk;
mod strategy;
mod types;
mod websocket;

use crate::config::AppConfig;
use crate::data::handlers::DataEventHandler;
use crate::data::{DataLifecycleManager, DataService};
use crate::error::AppError;
use crate::events::EventBus;
use crate::execution::ExecutionService;
use crate::portfolio::{PortfolioExecutionHandler, PortfolioService};
use crate::risk::RiskCheckResult;
use crate::risk::RiskService;
use crate::strategy::StrategyService;
use crate::strategy::build_latest_strategy_signal_snapshot;
use crate::types::{
    BacktestExperimentMetadata, BacktestResult, ExecutionTrade, OrderSide, OrderStatus, OrderType,
    MarketData, RiskLimits, StrategyConfig, StrategyExecutionOverview, StrategyLatestBacktestSummary,
    StrategyLatestRealTradeSummary, StrategyRecentSignalSummary, StrategySignalSnapshot,
};
use crate::websocket::{
    start_heartbeat, ws_handler_with_state, MarketDataUpdate, WSManager, WSMessage, WSState,
};
use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

static APP_BOOT_AT: OnceLock<String> = OnceLock::new();

/// Request body for creating a strategy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStrategyRequest {
    pub name: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub parameters: Option<serde_json::Value>,
    pub risk_limits: Option<RiskLimits>,
    pub is_active: Option<bool>,
}

/// Request body for creating an order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateOrderRequest {
    pub symbol: String,
    pub side: String,
    pub quantity: i64,
    pub price: Option<f64>,
    pub order_type: String,
    pub strategy_id: Option<String>,
    // Advanced order fields
    pub time_in_force: Option<String>, // Day, GTC, IOC, FOK
    pub stop_price: Option<f64>,       // For Stop/StopLimit orders
    pub extended_hours: Option<bool>,  // Allow trading in extended hours
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStrategyRequest {
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub parameters: Option<serde_json::Value>,
    pub risk_limits: Option<RiskLimits>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestRequest {
    pub start_date: String,
    pub end_date: String,
    pub experiment_label: Option<String>,
    pub experiment_note: Option<String>,
    pub parameter_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestBatchRequest {
    pub start_date: String,
    pub end_date: String,
    pub experiment_label: Option<String>,
    pub experiment_note: Option<String>,
    pub parameter_version: Option<String>,
    pub parameter_sets: Vec<std::collections::HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketDataHistoryQuery {
    pub start: String,
    pub end: String,
    pub interval: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperSimulationQuery {
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderAuditQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn normalize_history_interval(interval: Option<&str>) -> &'static str {
    match interval.unwrap_or("1d").to_ascii_lowercase().as_str() {
        "1m" | "1min" | "1minute" => "1m",
        "5m" | "5min" | "5minute" => "5m",
        "15m" | "15min" | "15minute" => "15m",
        "30m" | "30min" | "30minute" => "30m",
        "1h" | "60m" | "60min" => "1h",
        "1d" | "1day" | "day" => "1d",
        "1wk" | "1w" | "1week" | "week" => "1wk",
        "1mo" | "1month" | "month" => "1mo",
        _ => "1d",
    }
}

fn normalize_market_symbol(symbol: &str) -> String {
    let normalized = symbol.trim().to_ascii_uppercase();

    if normalized.ends_with(".HK") {
        let code = normalized.trim_end_matches(".HK");
        if code.chars().all(|c| c.is_ascii_digit()) {
            return format!("{:0>4}.HK", code);
        }
        return normalized;
    }

    if normalized.chars().all(|c| c.is_ascii_digit()) && normalized.len() <= 5 {
        return format!("{:0>4}.HK", normalized);
    }

    normalized
}

fn is_hk_symbol(symbol: &str) -> bool {
    let normalized = normalize_market_symbol(symbol);
    normalized.ends_with(".HK")
}

fn market_currency_for_symbol(symbol: &str) -> &'static str {
    if is_hk_symbol(symbol) {
        "HKD"
    } else {
        "USD"
    }
}

fn position_currency(position: &crate::types::Position) -> &'static str {
    market_currency_for_symbol(&position.symbol)
}

fn portfolio_display_currency(portfolio: &crate::types::Portfolio) -> &'static str {
    let currencies = portfolio
        .positions
        .values()
        .map(position_currency)
        .collect::<std::collections::BTreeSet<_>>();

    if currencies.is_empty() {
        return "USD";
    }

    if currencies.len() == 1 {
        let currency = *currencies.iter().next().unwrap();
        if currency == "USD" || portfolio.cash_balance == rust_decimal::Decimal::ZERO {
            return currency;
        }
    }

    "MIXED"
}

fn market_status_label(degraded: bool, has_error: bool) -> &'static str {
    if has_error {
        "error"
    } else if degraded {
        "degraded"
    } else {
        "live"
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchMarketDataRequest {
    pub symbols: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchSymbolQuery {
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListMarketQuery {
    pub exchange: Option<String>,
    pub country: Option<String>,
    pub instrument_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioPnlQuery {
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioPnlHistoryQuery {
    pub days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestListQuery {
    pub strategy_id: Option<String>,
    pub symbol: Option<String>,
    pub experiment_label: Option<String>,
    pub parameter_version: Option<String>,
    pub created_after: Option<DateTime<Utc>>,
    pub created_before: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeListQuery {
    pub strategy_id: Option<String>,
    pub symbol: Option<String>,
    pub limit: Option<i64>,
}

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub data_service: Arc<DataService>,
    pub strategy_service: Arc<StrategyService>,
    pub execution_service: Arc<ExecutionService>,
    pub portfolio_service: Arc<PortfolioService>,
    pub risk_service: Arc<RiskService>,
    pub event_bus: Arc<EventBus>,
    pub ws_manager: Arc<WSManager>,
    pub lifecycle_manager: Arc<RwLock<DataLifecycleManager>>,
}

#[tokio::main]
async fn main() -> Result<()> {
    APP_BOOT_AT.get_or_init(|| Utc::now().to_rfc3339());

    // Load configuration
    let config = Arc::new(AppConfig::load()?);

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(config.logging.level.clone()));

    let format = config.logging.format.to_lowercase();
    let subscriber = tracing_subscriber::fmt().with_env_filter(env_filter);
    if format == "json" {
        subscriber.json().init();
    } else if format == "pretty" {
        subscriber.pretty().init();
    } else {
        subscriber.init();
    }

    info!("Starting HK-US Quantitative Trading Platform");
    info!("Configuration loaded successfully");

    // Initialize services
    let server_addr = format!("{}:{}", config.server.host, config.server.port);
    let app_state = initialize_services(config).await?;
    info!("All services initialized successfully");

    app_state
        .event_bus
        .register_handler(DataEventHandler::new(app_state.data_service.clone()))
        .await?;
    app_state
        .event_bus
        .register_handler(PortfolioExecutionHandler::new(
            app_state.portfolio_service.clone(),
            app_state.execution_service.clone(),
            app_state.config.trading.default_portfolio_id.clone(),
        ))
        .await?;

    start_heartbeat(app_state.ws_manager.clone(), 30);

    let ws_manager = app_state.ws_manager.clone();
    let mut event_rx = app_state.event_bus.subscribe_local();
    tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            ws_manager.broadcast_event(&event);
        }
    });

    // Create router
    let app = create_router(app_state);

    // Start server
    let listener = TcpListener::bind(&server_addr).await?;
    info!("Server listening on http://{}", server_addr);

    axum::serve(listener, app).await?;

    Ok(())
}

async fn initialize_services(config: Arc<AppConfig>) -> Result<AppState> {
    // Initialize database connection pool
    let db_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(config.database.max_connections)
        .connect(&config.database.url)
        .await?;

    info!("Database connection pool established");

    // Run database migrations
    sqlx::migrate!("./migrations")
        .run(&db_pool)
        .await
        .map_err(|e| AppError::database(format!("Failed to run migrations: {}", e)))?;
    info!("Database migrations applied successfully");

    // Initialize Redis client
    let redis_client = redis::Client::open(config.redis.url.as_str())?;
    let redis_conn = redis_client.get_multiplexed_async_connection().await?;

    info!("Redis connection established");

    // Initialize event bus
    let event_bus = Arc::new(EventBus::new(redis_client.clone()).await?);

    // Initialize services
    let data_service =
        Arc::new(DataService::new(db_pool.clone(), redis_conn.clone(), event_bus.clone()).await?);
    let strategy_service =
        Arc::new(StrategyService::new(db_pool.clone(), event_bus.clone()).await?);
    let execution_service =
        Arc::new(ExecutionService::new(db_pool.clone(), event_bus.clone()).await?);
    let portfolio_service =
        Arc::new(PortfolioService::new(db_pool.clone(), event_bus.clone()).await?);
    let risk_service = Arc::new(
        RiskService::new(
            db_pool.clone(),
            event_bus.clone(),
            config.trading.max_order_size,
        )
        .await?,
    );
    let lifecycle_manager = Arc::new(RwLock::new(DataLifecycleManager::new(db_pool.clone())));
    let ws_manager = Arc::new(WSManager::new(1024));

    Ok(AppState {
        config,
        data_service,
        strategy_service,
        execution_service,
        portfolio_service,
        risk_service,
        event_bus,
        ws_manager,
        lifecycle_manager,
    })
}

fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/ws", get(websocket_upgrade))
        .route("/api/v1/market-data/:symbol", get(get_market_data))
        .route(
            "/api/v1/market-data/:symbol/history",
            get(get_market_data_history),
        )
        .route("/api/v1/market-data/batch", post(get_market_data_batch))
        .route("/api/v1/market-data/search", get(search_symbols))
        .route("/api/v1/market-data/list", get(list_market_symbols))
        .route("/api/v1/lifecycle/cleanup", post(run_cleanup))
        .route("/api/v1/lifecycle/archival", post(run_archival))
        .route("/api/v1/lifecycle/settings", get(get_lifecycle_settings))
        .route(
            "/api/v1/lifecycle/settings",
            post(update_lifecycle_settings),
        )
        .route("/api/v1/strategies", get(list_strategies))
        .route("/api/v1/strategies", post(create_strategy))
        .route("/api/v1/strategies/:strategy_id", put(update_strategy))
        .route("/api/v1/strategies/:strategy_id", delete(delete_strategy))
        .route(
            "/api/v1/strategies/:strategy_id/state",
            get(get_strategy_state),
        )
        .route("/api/v1/signals/latest", get(list_latest_signals))
        .route(
            "/api/v1/strategies/:strategy_id/signals/refresh",
            post(refresh_strategy_signal),
        )
        .route(
            "/api/v1/strategies/:strategy_id/backtest",
            post(run_backtest),
        )
        .route(
            "/api/v1/strategies/:strategy_id/backtest/batch",
            post(run_backtest_batch),
        )
        .route("/api/v1/backtests", get(list_backtests))
        .route("/api/v1/trades", get(list_trades))
        .route("/api/v1/orders", get(list_orders))
        .route("/api/v1/orders", post(create_order))
        .route("/api/v1/orders/simulate", post(run_paper_matching))
        .route("/api/v1/orders/:order_id", get(get_order))
        .route("/api/v1/orders/:order_id/audit", get(get_order_audit))
        .route("/api/v1/orders/:order_id", delete(cancel_order))
        .route("/api/v1/portfolio", get(get_portfolio))
        .route("/api/v1/portfolio/positions", get(get_positions))
        .route("/api/v1/portfolio/pnl", get(get_portfolio_pnl))
        .route(
            "/api/v1/portfolio/pnl/history",
            get(get_portfolio_pnl_history),
        )
        .route("/api/v1/risk/metrics", get(get_risk_metrics))
        .route("/api/v1/risk/limits", get(get_risk_limits))
        .route("/api/v1/risk/alerts", get(list_risk_alerts))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health_check(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let (summary, recent_error) = match collect_operational_summary(&state).await {
        Ok(summary) => (Some(summary), None),
        Err(error) => {
            warn!(error = %error, "Failed to collect operational summary");
            (None, Some(error.to_string()))
        }
    };

    Ok(Json(build_health_response(summary, recent_error)))
}

fn build_health_response(summary: Option<Value>, recent_error: Option<String>) -> Value {
    let status = if summary.is_some() {
        "healthy"
    } else {
        "warning"
    };

    json!({
        "status": status,
        "timestamp": chrono::Utc::now(),
        "deployed_at": app_deployed_at(),
        "recent_error": recent_error,
        "services": {
            "database": "connected",
            "redis": "connected",
            "data_service": "running",
            "strategy_service": "running",
            "execution_service": "running",
            "portfolio_service": "running",
            "risk_service": "running"
        },
        "summary": summary
    })
}

fn app_deployed_at() -> String {
    APP_BOOT_AT
        .get_or_init(|| chrono::Utc::now().to_rfc3339())
        .clone()
}

async fn collect_operational_summary(state: &AppState) -> Result<Value, AppError> {
    let strategies = state.strategy_service.list_strategies().await?;
    let recent_orders = state.execution_service.list_orders(25, 0).await?;
    let recent_backtests = state.strategy_service.list_backtest_runs(25).await?;
    let recent_trades = state.portfolio_service.list_trades(None, None, 25).await?;

    Ok(json!({
        "strategies_total": strategies.len(),
        "active_strategies": strategies.iter().filter(|strategy| strategy.is_active).count(),
        "recent_orders": recent_orders.len(),
        "recent_backtests": recent_backtests.len(),
        "recent_trades": recent_trades.len(),
        "latest_strategy_at": strategies.first().map(|strategy| strategy.updated_at),
        "latest_order_at": recent_orders.first().map(|order| order.created_at),
        "latest_backtest_at": recent_backtests.first().and_then(|result| result.created_at),
        "latest_trade_at": recent_trades.first().map(|trade| trade.executed_at),
    }))
}

async fn get_market_data(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<Value>, AppError> {
    info!("Fetching real market data for: {}", symbol);
    let market_data = match fetch_market_data_value(&symbol).await {
        Ok(data) => data,
        Err(error) => market_error_response(
            &symbol,
            &normalize_market_symbol(&symbol),
            "backend",
            &error.to_string(),
        ),
    };
    broadcast_market_data_update(&state, &market_data);
    Ok(Json(market_data))
}

async fn websocket_upgrade(
    State(state): State<AppState>,
    ws: axum::extract::ws::WebSocketUpgrade,
) -> impl axum::response::IntoResponse {
    let ws_state = WSState {
        manager: state.ws_manager.clone(),
        event_bus: state.event_bus.clone(),
    };

    ws_handler_with_state(ws, ws_state).await
}

async fn get_market_data_history(
    State(_state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<MarketDataHistoryQuery>,
) -> Result<Json<Value>, AppError> {
    use crate::market_data::yahoo_finance::YahooFinanceClient;
    use chrono::{Duration, NaiveDate, TimeZone};

    let normalized_symbol = normalize_market_symbol(&symbol);
    info!("Fetching historical market data for: {}", normalized_symbol);

    let yahoo_client = YahooFinanceClient::new();

    // Parse dates or use defaults
    let end = if query.end.is_empty() {
        chrono::Utc::now()
    } else {
        NaiveDate::parse_from_str(&query.end, "%Y-%m-%d")
            .ok()
            .and_then(|d| {
                chrono::Utc
                    .from_local_datetime(&d.and_hms_opt(0, 0, 0)?)
                    .single()
            })
            .unwrap_or_else(chrono::Utc::now)
    };

    let start = if query.start.is_empty() {
        end - Duration::days(30) // Default 30 days
    } else {
        NaiveDate::parse_from_str(&query.start, "%Y-%m-%d")
            .ok()
            .and_then(|d| {
                chrono::Utc
                    .from_local_datetime(&d.and_hms_opt(0, 0, 0)?)
                    .single()
            })
            .unwrap_or_else(|| end - Duration::days(30))
    };

    let interval = normalize_history_interval(query.interval.as_deref());

    if is_hk_symbol(&normalized_symbol) {
        if let Ok(history) = fetch_market_history_from_script(
            &normalized_symbol,
            query.interval.as_deref().unwrap_or(interval),
            &query.start,
            &query.end,
        )
        .await
        {
            return Ok(Json(history));
        }
    }

    match yahoo_client
        .get_historical_bars(&normalized_symbol, start, end, interval)
        .await
    {
        Ok(bars) => {
            let data: Vec<Value> = bars
                .iter()
                .map(|bar| {
                    json!({
                        "timestamp": bar.timestamp,
                        "open": bar.open_price.and_then(|p| p.to_f64()),
                        "high": bar.high_price.and_then(|p| p.to_f64()),
                        "low": bar.low_price.and_then(|p| p.to_f64()),
                        "close": bar.price.to_f64(),
                        "price": bar.price.to_f64(),
                        "volume": bar.volume,
                        "data_source": "yahoo",
                        "degraded": false,
                    })
                })
                .collect();

            if data.is_empty() {
                return Ok(Json(market_history_response(
                    &symbol,
                    &normalized_symbol,
                    data,
                    "yahoo",
                    false,
                    Some("No historical data returned".to_string()),
                    interval,
                )));
            }

            Ok(Json(market_history_response(
                &symbol,
                &normalized_symbol,
                data,
                "yahoo",
                false,
                None,
                interval,
            )))
        }
        Err(e) => Ok(Json(market_history_response(
            &symbol,
            &normalized_symbol,
            Vec::new(),
            "yahoo",
            false,
            Some(format!(
                "Failed to fetch historical data for {}: {}",
                normalized_symbol, e
            )),
            interval,
        ))),
    }
}

async fn get_market_data_batch(
    State(_state): State<AppState>,
    Json(req): Json<BatchMarketDataRequest>,
) -> Result<Json<Value>, AppError> {
    let mut tasks = Vec::with_capacity(req.symbols.len());

    for symbol in req.symbols {
        let symbol = symbol.clone();
        let task = tokio::spawn(async move {
            match fetch_market_data_value(&symbol).await {
                Ok(data) => data,
                Err(e) => json!({
                    "symbol": symbol,
                    "success": false,
                    "error": e.to_string()
                }),
            }
        });
        tasks.push(task);
    }

    let mut results = Vec::with_capacity(tasks.len());
    for task in tasks {
        if let Ok(result) = task.await {
            results.push(result);
        }
    }

    Ok(Json(json!(results)))
}

async fn search_symbols(
    State(_state): State<AppState>,
    Query(query): Query<SearchSymbolQuery>,
) -> Result<Json<Value>, AppError> {
    info!("Searching for symbols: {}", query.query);

    let script_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("market_data.py");

    let output = Command::new("python3")
        .arg(script_path)
        .arg("--search")
        .arg(&query.query)
        .output()
        .await;

    let output = match output {
        Ok(output) => output,
        Err(e) => {
            info!(
                "Search script execution failed for query '{}': {}. Returning fallback response.",
                query.query, e
            );
            return Ok(Json(json!({
                "success": false,
                "data": [],
                "error": format!("search unavailable: {}", e),
                "source": "fallback"
            })));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        info!(
            "Search script failed for query '{}': {}. Returning fallback response.",
            query.query, stderr
        );
        return Ok(Json(json!({
            "success": false,
            "data": [],
            "error": format!("search unavailable: {}", stderr),
            "source": "fallback"
        })));
    }

    let data: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|e| {
        info!(
            "Search response parse failed for query '{}': {}. Returning fallback response.",
            query.query, e
        );
        json!({
            "success": false,
            "data": [],
            "error": format!("invalid search response: {}", e),
            "source": "fallback"
        })
    });

    Ok(Json(data))
}

async fn list_market_symbols(
    State(_state): State<AppState>,
    Query(query): Query<ListMarketQuery>,
) -> Result<Json<Value>, AppError> {
    info!("Listing market symbols");

    let script_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("market_data.py");

    let mut cmd = Command::new("python3");
    cmd.arg(script_path).arg("--list-market");

    if let Some(exchange) = query.exchange {
        cmd.arg("--exchange").arg(exchange);
    }
    if let Some(country) = query.country {
        cmd.arg("--country").arg(country);
    }
    if let Some(itype) = query.instrument_type {
        cmd.arg("--type").arg(itype);
    }

    let output = cmd.output().await;

    let output = match output {
        Ok(output) => output,
        Err(e) => {
            info!(
                "List market script execution failed: {}. Returning fallback response.",
                e
            );
            return Ok(Json(json!({
                "success": false,
                "count": 0,
                "data": [],
                "error": format!("market list unavailable: {}", e),
                "source": "fallback"
            })));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        info!(
            "List market script failed: {}. Returning fallback response.",
            stderr
        );
        return Ok(Json(json!({
            "success": false,
            "count": 0,
            "data": [],
            "error": format!("market list unavailable: {}", stderr),
            "source": "fallback"
        })));
    }

    let data: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|e| {
        info!(
            "List market response parse failed: {}. Returning fallback response.",
            e
        );
        json!({
            "success": false,
            "count": 0,
            "data": [],
            "error": format!("invalid market list response: {}", e),
            "source": "fallback"
        })
    });

    Ok(Json(data))
}

async fn get_order(
    State(state): State<AppState>,
    axum::extract::Path(order_id): axum::extract::Path<String>,
) -> Result<Json<Value>, AppError> {
    let order_id =
        Uuid::parse_str(&order_id).map_err(|_| AppError::validation("Invalid order id"))?;
    let order = state.execution_service.get_order(order_id).await?;
    Ok(Json(order_to_json(order)))
}

async fn get_portfolio_pnl(
    State(state): State<AppState>,
    Query(query): Query<PortfolioPnlQuery>,
) -> Result<Json<Value>, AppError> {
    let portfolio_id = state.config.trading.default_portfolio_id.clone();
    let date = match query.date {
        Some(date) => parse_datetime(&date)?,
        None => Utc::now(),
    };

    let portfolio = state
        .portfolio_service
        .get_portfolio_value(&portfolio_id)
        .await?;

    Ok(Json(json!({
        "portfolio_id": portfolio_id,
        "date": date.date_naive().to_string(),
        "total_value": portfolio.total_value.to_f64().unwrap_or(0.0),
        "cash_balance": portfolio.cash_balance.to_f64().unwrap_or(0.0),
        "unrealized_pnl": portfolio.unrealized_pnl.to_f64().unwrap_or(0.0),
        "realized_pnl": portfolio.realized_pnl.to_f64().unwrap_or(0.0),
        "generated_at": Utc::now().to_rfc3339(),
    })))
}

async fn list_risk_alerts(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let alerts = state.risk_service.list_alerts(100, 0).await?;
    let output = alerts
        .into_iter()
        .map(|a| {
            json!({
                "id": a.id,
                "alert_type": a.alert_type,
                "message": a.message,
                "severity": a.severity,
                "created_at": a.created_at.to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!(output)))
}

async fn get_portfolio_pnl_history(
    State(state): State<AppState>,
    Query(query): Query<PortfolioPnlHistoryQuery>,
) -> Result<Json<Value>, AppError> {
    let portfolio_id = state.config.trading.default_portfolio_id.clone();
    let days = query.days.unwrap_or(30);
    let history = state
        .portfolio_service
        .get_pnl_history(&portfolio_id, days)
        .await?;

    Ok(Json(json!(history
        .into_iter()
        .map(|point| json!({
            "date": point.date.to_string(),
            "total_pnl": point.total_pnl.to_f64().unwrap_or(0.0),
            "realized_pnl": point.realized_pnl.to_f64().unwrap_or(0.0),
            "unrealized_pnl": point.unrealized_pnl.to_f64().unwrap_or(0.0),
        }))
        .collect::<Vec<_>>())))
}

async fn update_strategy(
    State(state): State<AppState>,
    Path(strategy_id): Path<String>,
    Json(req): Json<UpdateStrategyRequest>,
) -> Result<Json<Value>, AppError> {
    let mut config = state
        .strategy_service
        .get_strategy_config(&strategy_id)
        .await?;

    if let Some(name) = req.name {
        config.name = name;
    }
    if let Some(display_name) = req.display_name {
        config.display_name = Some(display_name);
    }
    if let Some(description) = req.description {
        config.description = Some(description);
    }
    if let Some(is_active) = req.is_active {
        config.is_active = is_active;
    }
    if let Some(risk_limits) = req.risk_limits {
        config.risk_limits = risk_limits;
    }
    if let Some(parameters) = req.parameters {
        let params = parameters
            .as_object()
            .ok_or_else(|| AppError::validation("parameters must be an object"))?
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<std::collections::HashMap<_, _>>();
        config.parameters = params;
    }

    config.updated_at = Utc::now();
    state.strategy_service.load_strategy(config.clone()).await?;

    let stored_config = state
        .strategy_service
        .get_strategy_config(&strategy_id)
        .await?;
    Ok(Json(strategy_config_to_json(stored_config)))
}

async fn delete_strategy(
    State(state): State<AppState>,
    Path(strategy_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.strategy_service.delete_strategy(&strategy_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn run_backtest(
    State(state): State<AppState>,
    Path(strategy_id): Path<String>,
    Json(req): Json<BacktestRequest>,
) -> Result<Json<Value>, AppError> {
    let start = parse_backtest_datetime(&req.start_date)?;
    let end = parse_backtest_datetime(&req.end_date)?;
    validate_backtest_date_range(start, end)?;
    let metadata = build_backtest_experiment_metadata(
        req.experiment_label,
        req.experiment_note,
        req.parameter_version,
    );
    let result = state
        .strategy_service
        .run_backtest_with_metadata(&strategy_id, start, end, metadata)
        .await?;
    Ok(Json(backtest_to_json(result)))
}

async fn run_backtest_batch(
    State(state): State<AppState>,
    Path(strategy_id): Path<String>,
    Json(req): Json<BacktestBatchRequest>,
) -> Result<Json<Value>, AppError> {
    let start = parse_backtest_datetime(&req.start_date)?;
    let end = parse_backtest_datetime(&req.end_date)?;
    validate_backtest_date_range(start, end)?;
    if !(2..=5).contains(&req.parameter_sets.len()) {
        return Err(AppError::invalid_backtest_parameters(
            "Batch experiments require between 2 and 5 parameter sets.",
        ));
    }

    let results = state
        .strategy_service
        .run_backtest_batch(
            &strategy_id,
            start,
            end,
            req.experiment_label,
            req.experiment_note,
            req.parameter_version,
            req.parameter_sets,
        )
        .await?;
    Ok(Json(json!({
        "experiment_id": results
            .first()
            .and_then(|result| result.experiment_id)
            .map(|id| id.to_string()),
        "count": results.len(),
        "results": results.into_iter().map(backtest_to_json).collect::<Vec<_>>()
    })))
}

async fn list_backtests(
    State(state): State<AppState>,
    Query(query): Query<BacktestListQuery>,
) -> Result<Json<Value>, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let results = state
        .strategy_service
        .list_backtest_runs_filtered(
            limit,
            query.strategy_id.as_deref(),
            query.symbol.as_deref(),
            query.experiment_label.as_deref(),
            query.parameter_version.as_deref(),
            query.created_after,
            query.created_before,
        )
        .await?;
    Ok(Json(json!(results
        .into_iter()
        .map(backtest_to_json)
        .collect::<Vec<_>>())))
}

async fn get_strategy_state(
    State(state): State<AppState>,
    Path(strategy_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let latest_backtest = state
        .strategy_service
        .list_backtest_runs_filtered(1, Some(&strategy_id), None, None, None, None, None)
        .await?
        .into_iter()
        .next();

    let latest_real_trade = state
        .portfolio_service
        .list_trades(Some(&strategy_id), None, 1)
        .await?
        .into_iter()
        .next();

    let strategy_config = state.strategy_service.get_strategy_config(&strategy_id).await.ok();
    let strategy_name = strategy_config
        .as_ref()
        .and_then(|config| config.display_name.clone().or(Some(config.name.clone())));

    let mut overview = build_strategy_execution_overview(
        strategy_id,
        strategy_name.clone(),
        latest_backtest,
        latest_real_trade,
    );

    if let Some(config) = strategy_config.as_ref() {
        let snapshot = load_latest_signal_snapshot_for_strategy(config).await;
        let status = if snapshot.signal_type.is_some() {
            "live"
        } else if snapshot.note.contains("失败") || snapshot.note.contains("不足") {
            "error"
        } else {
            "empty"
        };
        overview.recent_signal = build_recent_signal_summary_from_snapshot(&snapshot, status);
    }

    Ok(Json(json!(overview)))
}

async fn fetch_market_data_value(symbol: &str) -> Result<Value, AppError> {
    use crate::market_data::yahoo_finance::YahooFinanceClient;

    let normalized_symbol = normalize_market_symbol(symbol);

    if is_hk_symbol(&normalized_symbol) {
        return fetch_market_data_from_script(&normalized_symbol).await;
    }

    // Try Yahoo Finance first (free, no API key needed)
    let yahoo_client = YahooFinanceClient::new();

    match yahoo_client.get_quote(&normalized_symbol).await {
        Ok(data) => {
            let change = data.price_change();
            let change_percent = data.price_change_percent();

            Ok(market_quote_response(
                symbol,
                &normalized_symbol,
                json!({
                    "symbol": data.symbol,
                    "price": data.price.to_f64().unwrap_or(0.0),
                    "volume": data.volume,
                    "timestamp": data.timestamp,
                    "currency": market_currency_for_symbol(&data.symbol),
                    "previous_close": data.previous_close.and_then(|p| p.to_f64()),
                    "change": change.and_then(|c| c.to_f64()),
                    "change_percent": change_percent,
                    "data_source": "Yahoo Finance",
                    "exchange": data.exchange.unwrap_or_else(|| "N/A".to_string()),
                }),
                "yahoo",
                false,
                None,
            ))
        }
        Err(e) => Err(AppError::market_data(format!(
            "Failed to fetch real-time market data for {}: {}",
            normalized_symbol, e
        ))),
    }
}

fn broadcast_market_data_update(state: &AppState, market_data: &Value) {
    let Some(symbol) = market_data
        .get("data")
        .and_then(|data| data.get("symbol"))
        .and_then(Value::as_str)
    else {
        return;
    };

    let price = market_data
        .get("data")
        .and_then(|data| data.get("price"))
        .and_then(Value::as_f64)
        .unwrap_or_default()
        .to_string();
    let volume = market_data
        .get("data")
        .and_then(|data| data.get("volume"))
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let exchange = market_data
        .get("data")
        .and_then(|data| data.get("exchange"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let currency = market_data
        .get("data")
        .and_then(|data| data.get("currency"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| Some(market_currency_for_symbol(symbol).to_string()));
    let timestamp = market_data
        .get("data")
        .and_then(|data| data.get("timestamp"))
        .and_then(Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let message = WSMessage::MarketData(MarketDataUpdate {
        symbol: symbol.to_string(),
        price,
        volume,
        exchange,
        currency,
        timestamp,
    });

    let _ = state.ws_manager.broadcast(message);
}

async fn fetch_market_data_from_script(symbol: &str) -> Result<Value, AppError> {
    let script_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("market_data.py");

    let output = Command::new("python3")
        .arg(script_path)
        .arg("--symbol")
        .arg(symbol)
        .output()
        .await
        .map_err(|e| {
            AppError::market_data(format!(
                "Failed to run market data provider for {}: {}",
                symbol, e
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::market_data(format!(
            "Market data provider failed for {}: {}",
            symbol, stderr
        )));
    }

    let response: Value = serde_json::from_slice(&output.stdout).map_err(|e| {
        AppError::market_data(format!(
            "Invalid market data response for {}: {}",
            symbol, e
        ))
    })?;

    let success = response
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !success {
        let message = response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown market data provider error");
        return Err(AppError::market_data(format!(
            "Market data provider error for {}: {}",
            symbol, message
        )));
    }

    let data = response
        .get("data")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::market_data(format!("Missing data payload for {}", symbol)))?;

    let price = data.get("price").and_then(Value::as_f64).unwrap_or(0.0);
    let previous_close = data.get("previous_close").and_then(Value::as_f64);
    let change = previous_close.map(|prev| price - prev);
    let change_percent = previous_close.and_then(|prev| {
        if prev.abs() > f64::EPSILON {
            Some(((price - prev) / prev) * 100.0)
        } else {
            None
        }
    });

    let source = response
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("provider");
    let degraded = response
        .get("degraded")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let note = response
        .get("note")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            response
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string)
        });

    Ok(market_quote_response(
        symbol,
        symbol,
        json!({
            "symbol": response.get("symbol").and_then(Value::as_str).unwrap_or(symbol),
            "price": price,
            "volume": data.get("volume").and_then(Value::as_i64).unwrap_or(0),
            "timestamp": response.get("timestamp").cloned().unwrap_or_else(|| json!(Utc::now())),
            "currency": "HKD",
            "previous_close": previous_close,
            "open": data.get("open").and_then(Value::as_f64),
            "high": data.get("high").and_then(Value::as_f64),
            "low": data.get("low").and_then(Value::as_f64),
            "change": change,
            "change_percent": change_percent,
            "data_source": source,
            "exchange": "HKEX",
        }),
        source,
        degraded,
        note,
    ))
}

async fn fetch_market_history_from_script(
    symbol: &str,
    interval: &str,
    start: &str,
    end: &str,
) -> Result<Value, AppError> {
    let script_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("market_data.py");

    let mut cmd = Command::new("python3");
    cmd.arg(script_path)
        .arg("--symbol")
        .arg(symbol)
        .arg("--history")
        .arg("--interval")
        .arg(interval);

    if !start.is_empty() {
        cmd.arg("--start").arg(start);
    }
    if !end.is_empty() {
        cmd.arg("--end").arg(end);
    }

    let output = cmd.output().await.map_err(|e| {
        AppError::market_data(format!(
            "Failed to run historical data provider for {}: {}",
            symbol, e
        ))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::market_data(format!(
            "Historical data provider failed for {}: {}",
            symbol, stderr
        )));
    }

    let response: Value = serde_json::from_slice(&output.stdout).map_err(|e| {
        AppError::market_data(format!(
            "Invalid historical data response for {}: {}",
            symbol, e
        ))
    })?;

    let success = response
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !success {
        let message = response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown historical data provider error");
        return Err(AppError::market_data(format!(
            "Historical data provider error for {}: {}",
            symbol, message
        )));
    }

    let values = response
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::market_data(format!("Missing historical data payload for {}", symbol))
        })?;

    let normalized = values
        .iter()
        .filter_map(|item| {
            let timestamp = item.get("timestamp")?.clone();
            let close = item
                .get("close")
                .and_then(Value::as_f64)
                .or_else(|| item.get("price").and_then(Value::as_f64))?;
            Some(json!({
                "timestamp": timestamp,
                "open": item.get("open").cloned().unwrap_or(Value::Null),
                "high": item.get("high").cloned().unwrap_or(Value::Null),
                "low": item.get("low").cloned().unwrap_or(Value::Null),
                "close": close,
                "volume": item.get("volume").cloned().unwrap_or_else(|| json!(0)),
                "data_source": response.get("source").cloned().unwrap_or_else(|| json!("provider")),
                "degraded": false,
            }))
        })
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        return Err(AppError::market_data(format!(
            "No historical data returned for {}",
            symbol
        )));
    }

    let source = response
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("provider");
    let degraded = response
        .get("degraded")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let note = response
        .get("note")
        .and_then(Value::as_str)
        .map(str::to_string);

    Ok(market_history_response(
        symbol,
        symbol,
        normalized,
        source,
        degraded,
        note,
        normalize_history_interval(Some(interval)),
    ))
}

fn market_quote_response(
    requested_symbol: &str,
    normalized_symbol: &str,
    data: Value,
    source: &str,
    degraded: bool,
    error_message: Option<String>,
) -> Value {
    let has_error = error_message.is_some() && !degraded;
    let error_value = if has_error {
        error_message.clone()
    } else {
        None
    };
    json!({
        "success": !has_error,
        "data": data,
        "meta": {
            "status": market_status_label(degraded, has_error),
            "source": source,
            "fallback_used": degraded,
            "is_stale": degraded,
            "degraded": degraded,
            "requested_symbol": requested_symbol,
            "normalized_symbol": normalized_symbol,
            "message": error_message,
        },
        "error": error_value,
    })
}

fn market_history_response(
    requested_symbol: &str,
    normalized_symbol: &str,
    data: Vec<Value>,
    source: &str,
    degraded: bool,
    error_message: Option<String>,
    interval: &str,
) -> Value {
    let has_error = error_message.is_some() && !degraded;
    let error_value = if has_error {
        error_message.clone()
    } else {
        None
    };
    json!({
        "success": !has_error,
        "data": data,
        "meta": {
            "status": market_status_label(degraded, has_error),
            "source": source,
            "fallback_used": degraded,
            "is_stale": degraded,
            "degraded": degraded,
            "requested_symbol": requested_symbol,
            "normalized_symbol": normalized_symbol,
            "interval": interval,
            "message": error_message,
        },
        "error": error_value,
    })
}

fn market_error_response(
    requested_symbol: &str,
    normalized_symbol: &str,
    source: &str,
    message: &str,
) -> Value {
    market_quote_response(
        requested_symbol,
        normalized_symbol,
        json!({
            "symbol": normalized_symbol,
            "timestamp": Utc::now().to_rfc3339(),
            "currency": market_currency_for_symbol(normalized_symbol),
        }),
        source,
        false,
        Some(message.to_string()),
    )
}

fn parse_datetime(input: &str) -> Result<DateTime<Utc>, AppError> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(input) {
        return Ok(dt.with_timezone(&Utc));
    }

    if let Ok(date) = NaiveDate::parse_from_str(input, "%Y-%m-%d") {
        let dt = date
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| AppError::validation("Invalid date"))?;
        return Ok(DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc));
    }

    Err(AppError::validation("Invalid datetime format"))
}

fn parse_backtest_datetime(input: &str) -> Result<DateTime<Utc>, AppError> {
    parse_datetime(input).map_err(|_| {
        AppError::invalid_backtest_parameters(
            "Invalid backtest date format. Use YYYY-MM-DD or RFC3339.",
        )
    })
}

fn validate_backtest_date_range(start: DateTime<Utc>, end: DateTime<Utc>) -> Result<(), AppError> {
    if end < start {
        return Err(AppError::invalid_backtest_parameters(
            "Invalid backtest date range: end_date must be on or after start_date.",
        ));
    }

    Ok(())
}

fn backtest_to_json(result: crate::types::BacktestResult) -> Value {
    json!({
        "run_id": result.run_id.map(|id| id.to_string()),
        "experiment_id": result.experiment_id.map(|id| id.to_string()),
        "experiment_label": result.experiment_label,
        "experiment_note": result.experiment_note,
        "parameter_version": result.parameter_version,
        "strategy_id": result.strategy_id,
        "strategy_name": result.strategy_name,
        "symbol": result.symbol,
        "timeframe": result.timeframe,
        "parameters": result.parameters,
        "data_quality": result.data_quality.as_ref().map(|quality| json!({
            "source_label": quality.source_label,
            "local_data_hit": quality.local_data_hit,
            "external_data_fallback": quality.external_data_fallback,
            "bar_count": quality.bar_count,
            "minimum_required_bars": quality.minimum_required_bars,
            "data_insufficient": quality.data_insufficient,
            "notes": quality.notes,
            "missing_intervals": quality.missing_intervals.iter().map(|gap| json!({
                "start": gap.start.to_rfc3339(),
                "end": gap.end.to_rfc3339(),
                "expected_interval_seconds": gap.expected_interval_seconds,
                "observed_interval_seconds": gap.observed_interval_seconds,
                "missing_bars_hint": gap.missing_bars_hint,
            })).collect::<Vec<_>>(),
        })),
        "assumptions": result.assumptions.as_ref().map(|assumptions| json!({
            "fee_bps": assumptions.fee_bps,
            "slippage_bps": assumptions.slippage_bps,
            "max_position_fraction": assumptions.max_position_fraction,
            "rebalancing_logic": assumptions.rebalancing_logic,
            "data_source": assumptions.data_source,
        })),
        "execution_link": result.execution_link.as_ref().map(|link| json!({
            "status": link.status,
            "reference_scope": link.reference_scope,
            "explicit_link_id": link.explicit_link_id.map(|id| id.to_string()),
            "note": link.note,
        })),
        "trades": result.trades.map(|trades| trades.into_iter().map(|trade| json!({
            "timestamp": trade.timestamp.to_rfc3339(),
            "side": trade.side,
            "quantity": trade.quantity,
            "signal_price": trade.signal_price.to_f64().unwrap_or(0.0),
            "execution_price": trade.execution_price.to_f64().unwrap_or(0.0),
            "fees": trade.fees.to_f64().unwrap_or(0.0),
            "pnl": trade.pnl.and_then(|value| value.to_f64()),
        })).collect::<Vec<_>>()),
        "equity_curve": result.equity_curve.map(|points| points.into_iter().map(|point| json!({
            "timestamp": point.timestamp.to_rfc3339(),
            "equity": point.equity.to_f64().unwrap_or(0.0),
            "cash": point.cash.to_f64().unwrap_or(0.0),
            "position_quantity": point.position_quantity,
            "market_price": point.market_price.to_f64().unwrap_or(0.0),
        })).collect::<Vec<_>>()),
        "start_date": result.start_date.to_rfc3339(),
        "end_date": result.end_date.to_rfc3339(),
        "initial_capital": result.initial_capital.to_f64().unwrap_or(0.0),
        "final_capital": result.final_capital.to_f64().unwrap_or(0.0),
        "total_return": result.total_return,
        "annualized_return": result.annualized_return,
        "sharpe_ratio": result.sharpe_ratio,
        "max_drawdown": result.max_drawdown,
        "win_rate": result.win_rate,
        "total_trades": result.total_trades,
        "created_at": result.created_at.map(|dt| dt.to_rfc3339()),
        "performance_metrics": {
            "total_pnl": result.performance_metrics.total_pnl.to_f64().unwrap_or(0.0),
            "realized_pnl": result.performance_metrics.realized_pnl.to_f64().unwrap_or(0.0),
            "unrealized_pnl": result.performance_metrics.unrealized_pnl.to_f64().unwrap_or(0.0),
            "gross_profit": result.performance_metrics.gross_profit.to_f64().unwrap_or(0.0),
            "gross_loss": result.performance_metrics.gross_loss.to_f64().unwrap_or(0.0),
            "profit_factor": result.performance_metrics.profit_factor,
            "average_win": result.performance_metrics.average_win.to_f64().unwrap_or(0.0),
            "average_loss": result.performance_metrics.average_loss.to_f64().unwrap_or(0.0),
            "largest_win": result.performance_metrics.largest_win.to_f64().unwrap_or(0.0),
            "largest_loss": result.performance_metrics.largest_loss.to_f64().unwrap_or(0.0),
        }
    })
}

fn build_strategy_execution_overview(
    strategy_id: String,
    strategy_name: Option<String>,
    latest_backtest: Option<BacktestResult>,
    latest_real_trade: Option<ExecutionTrade>,
) -> StrategyExecutionOverview {
    let latest_backtest_summary = latest_backtest
        .as_ref()
        .map(summarize_backtest_for_strategy_state);
    let latest_real_trade_summary = latest_real_trade
        .as_ref()
        .map(summarize_real_trade_for_strategy_state);
    let reference_symbol = latest_backtest_summary
        .as_ref()
        .and_then(|summary| summary.symbol.clone())
        .or_else(|| {
            latest_real_trade_summary
                .as_ref()
                .map(|summary| summary.symbol.clone())
        });
    let reference_timeframe = latest_backtest_summary
        .as_ref()
        .and_then(|summary| summary.timeframe.clone());

    StrategyExecutionOverview {
        strategy_id: strategy_id.clone(),
        strategy_name: strategy_name.clone(),
        latest_backtest: latest_backtest_summary,
        latest_real_trade: latest_real_trade_summary,
        recent_signal: build_recent_signal_placeholder(
            strategy_id,
            strategy_name,
            reference_symbol,
            reference_timeframe,
        ),
        generated_at: Utc::now(),
    }
}

fn summarize_backtest_for_strategy_state(result: &BacktestResult) -> StrategyLatestBacktestSummary {
    StrategyLatestBacktestSummary {
        source: "backtest_runs".to_string(),
        run_id: result.run_id,
        created_at: result.created_at,
        strategy_id: result.strategy_id.clone(),
        strategy_name: result.strategy_name.clone(),
        symbol: result.symbol.clone(),
        timeframe: result.timeframe.clone(),
        experiment_label: result.experiment_label.clone(),
        parameter_version: result.parameter_version.clone(),
        total_return: result.total_return,
        annualized_return: result.annualized_return,
        sharpe_ratio: result.sharpe_ratio,
        max_drawdown: result.max_drawdown,
        total_trades: result.total_trades,
        note: "研究回测结果，仅供参考，不代表真实执行".to_string(),
    }
}

fn summarize_real_trade_for_strategy_state(
    trade: &ExecutionTrade,
) -> StrategyLatestRealTradeSummary {
    StrategyLatestRealTradeSummary {
        source: "trades".to_string(),
        trade_id: trade.id,
        order_id: trade.order_id,
        executed_at: trade.executed_at,
        strategy_id: trade.strategy_id.clone(),
        portfolio_id: trade.portfolio_id.clone(),
        symbol: trade.symbol.clone(),
        side: trade.side.clone(),
        quantity: trade.quantity,
        price: trade.price,
        note: "真实执行成交".to_string(),
    }
}

fn build_recent_signal_placeholder(
    strategy_id: String,
    strategy_name: Option<String>,
    symbol: Option<String>,
    timeframe: Option<String>,
) -> StrategyRecentSignalSummary {
    let note = if symbol.is_some() || timeframe.is_some() {
        "信号尚未持久化，当前仅预留确认台结构，回测上下文可作为人工复核参考。".to_string()
    } else {
        "信号尚未持久化，当前仅预留确认台结构。".to_string()
    };

    StrategyRecentSignalSummary {
        source: "signal_events_not_persisted".to_string(),
        status: "placeholder".to_string(),
        confirmation_state: "manual_review_only".to_string(),
        strategy_id,
        strategy_name,
        symbol,
        timeframe,
        latest_signal_at: None,
        signal_type: None,
        strength: None,
        note,
    }
}

fn strategy_signal_snapshot_to_json(snapshot: StrategySignalSnapshot) -> Value {
    json!({
        "strategy_id": snapshot.strategy_id,
        "strategy_name": snapshot.strategy_name,
        "symbol": snapshot.symbol,
        "timeframe": snapshot.timeframe,
        "signal_type": snapshot.signal_type.map(|value| format!("{:?}", value)),
        "strength": snapshot.strength,
        "generated_at": snapshot.generated_at.to_rfc3339(),
        "source": snapshot.source,
        "confirmation_state": snapshot.confirmation_state,
        "note": snapshot.note,
        "suggested_order": snapshot.suggested_order.map(|draft| json!({
            "symbol": draft.symbol,
            "side": draft.side,
            "quantity": draft.quantity,
            "strategy_id": draft.strategy_id,
        })),
    })
}

fn signal_history_window(timeframe: &str) -> chrono::Duration {
    match normalize_history_interval(Some(timeframe)) {
        "1m" => chrono::Duration::days(7),
        "5m" => chrono::Duration::days(30),
        "15m" => chrono::Duration::days(60),
        "30m" => chrono::Duration::days(90),
        "1h" => chrono::Duration::days(180),
        "1wk" => chrono::Duration::days(730),
        "1mo" => chrono::Duration::days(1825),
        _ => chrono::Duration::days(365),
    }
}

async fn fetch_signal_history(symbol: &str, timeframe: &str) -> Result<Vec<MarketData>, AppError> {
    use crate::market_data::yahoo_finance::YahooFinanceClient;

    let client = YahooFinanceClient::new();
    let normalized_symbol = normalize_market_symbol(symbol);
    let interval = normalize_history_interval(Some(timeframe));
    let end = Utc::now();
    let start = end - signal_history_window(timeframe);

    client
        .get_historical_bars(&normalized_symbol, start, end, interval)
        .await
}

fn build_signal_snapshot_failure(
    strategy_id: String,
    strategy_name: Option<String>,
    symbol: Option<String>,
    timeframe: Option<String>,
    reason: String,
) -> StrategySignalSnapshot {
    StrategySignalSnapshot {
        strategy_id,
        strategy_name,
        symbol,
        timeframe,
        signal_type: None,
        strength: None,
        generated_at: Utc::now(),
        source: "strategy_signal_refresh_failed".to_string(),
        confirmation_state: "manual_review_only".to_string(),
        note: reason,
        suggested_order: None,
    }
}

fn build_recent_signal_summary_from_snapshot(
    snapshot: &StrategySignalSnapshot,
    status: &str,
) -> StrategyRecentSignalSummary {
    StrategyRecentSignalSummary {
        source: snapshot.source.clone(),
        status: status.to_string(),
        confirmation_state: snapshot.confirmation_state.clone(),
        strategy_id: snapshot.strategy_id.clone(),
        strategy_name: snapshot.strategy_name.clone(),
        symbol: snapshot.symbol.clone(),
        timeframe: snapshot.timeframe.clone(),
        latest_signal_at: Some(snapshot.generated_at),
        signal_type: snapshot.signal_type,
        strength: snapshot.strength,
        note: snapshot.note.clone(),
    }
}

async fn load_latest_signal_snapshot_for_strategy(
    config: &StrategyConfig,
) -> StrategySignalSnapshot {
    let strategy_name = config.display_name.clone().or_else(|| Some(config.name.clone()));
    let symbol = config
        .parameters
        .get("symbol")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| "AAPL".to_string());
    let timeframe = config
        .parameters
        .get("timeframe")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| "1d".to_string());

    match fetch_signal_history(&symbol, &timeframe).await {
        Ok(bars) => build_latest_strategy_signal_snapshot(
            config.id.clone(),
            strategy_name,
            config,
            Some(timeframe),
            &bars,
        ),
        Err(error) => build_signal_snapshot_failure(
            config.id.clone(),
            strategy_name,
            Some(symbol),
            Some(timeframe),
            format!("行情不足或策略生成失败，不会自动下单：{}", error),
        ),
    }
}

fn build_backtest_experiment_metadata(
    experiment_label: Option<String>,
    experiment_note: Option<String>,
    parameter_version: Option<String>,
) -> Option<BacktestExperimentMetadata> {
    if experiment_label.is_none() && experiment_note.is_none() && parameter_version.is_none() {
        return None;
    }

    Some(BacktestExperimentMetadata {
        experiment_id: None,
        experiment_label,
        experiment_note,
        parameter_version,
    })
}

async fn list_latest_signals(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let strategies = state.strategy_service.list_strategies().await?;
    let mut snapshots = Vec::new();

    for config in strategies.into_iter().filter(|config| config.is_active) {
        let snapshot = load_latest_signal_snapshot_for_strategy(&config).await;
        snapshots.push(strategy_signal_snapshot_to_json(snapshot));
    }

    Ok(Json(json!(snapshots)))
}

async fn refresh_strategy_signal(
    State(state): State<AppState>,
    Path(strategy_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let config = state.strategy_service.get_strategy_config(&strategy_id).await?;
    let snapshot = load_latest_signal_snapshot_for_strategy(&config).await;
    Ok(Json(strategy_signal_snapshot_to_json(snapshot)))
}

async fn list_strategies(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let strategies = state.strategy_service.list_strategies().await?;
    Ok(Json(json!(strategies
        .into_iter()
        .map(strategy_config_to_json)
        .collect::<Vec<_>>())))
}

async fn create_strategy(
    State(state): State<AppState>,
    Json(req): Json<CreateStrategyRequest>,
) -> Result<Json<Value>, AppError> {
    let config = build_strategy_config_from_request(req);

    state.strategy_service.load_strategy(config.clone()).await?;
    info!("Created strategy: {} ({})", config.name, config.id);
    let stored_config = state
        .strategy_service
        .get_strategy_config(&config.id)
        .await?;
    Ok(Json(strategy_config_to_json(stored_config)))
}

async fn create_order(
    State(state): State<AppState>,
    Json(req): Json<CreateOrderRequest>,
) -> Result<impl IntoResponse, AppError> {
    let side = match req.side.to_lowercase().as_str() {
        "buy" => OrderSide::Buy,
        "sell" => OrderSide::Sell,
        _ => return Err(AppError::validation("Invalid order side")),
    };

    let order_type = match req.order_type.to_lowercase().as_str() {
        "market" => OrderType::Market,
        "limit" => OrderType::Limit,
        "stop" => OrderType::Stop,
        "stop_limit" | "stoplimit" | "stop-limit" => OrderType::StopLimit,
        _ => return Err(AppError::validation("Invalid order type")),
    };

    let mut order = crate::types::Order::new(req.symbol.clone(), side, req.quantity, order_type);

    if let Some(price) = req.price {
        let price = rust_decimal::Decimal::from_f64(price)
            .ok_or_else(|| AppError::validation("Invalid price"))?;
        order = order.with_price(price);
    }

    if let Some(stop_price) = req.stop_price {
        let stop_price = rust_decimal::Decimal::from_f64(stop_price)
            .ok_or_else(|| AppError::validation("Invalid stop price"))?;
        order = order.with_stop_price(stop_price);
    }

    if let Some(tif) = &req.time_in_force {
        order = order.with_time_in_force(tif.clone());
    }

    if let Some(ext) = req.extended_hours {
        order = order.with_extended_hours(ext);
    }

    if let Some(strategy_id) = req.strategy_id {
        order = order.with_strategy(strategy_id);
    }

    if state.config.trading.risk_check_enabled {
        let check_result = state.risk_service.check_pre_trade_risk(&order).await?;
        if let RiskCheckResult::Rejected { .. } = &check_result {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({
                    "accepted": false,
                    "order_preview": order_to_json(order),
                    "risk_check": risk_check_to_json(&check_result),
                })),
            ));
        }

        let mut created = state.execution_service.create_order_direct(order).await?;
        created = if state.config.trading.paper_trading {
            state
                .execution_service
                .submit_paper_order(created.id)
                .await?
        } else {
            state.execution_service.submit_order(created.id).await?
        };

        info!(
            "Created order: {} - {:?} {} {} {:?} @ {:?}",
            created.id,
            created.side,
            created.quantity,
            created.symbol,
            created.order_type,
            created.price
        );

        return Ok((
            StatusCode::OK,
            Json(json!({
                "accepted": true,
                "order": order_to_json(created),
                "risk_check": risk_check_to_json(&check_result),
            })),
        ));
    }

    let mut created = state.execution_service.create_order_direct(order).await?;
    created = if state.config.trading.paper_trading {
        state
            .execution_service
            .submit_paper_order(created.id)
            .await?
    } else {
        state.execution_service.submit_order(created.id).await?
    };

    info!(
        "Created order: {} - {:?} {} {} {:?} @ {:?}",
        created.id,
        created.side,
        created.quantity,
        created.symbol,
        created.order_type,
        created.price
    );

    Ok((
        StatusCode::OK,
        Json(json!({
            "accepted": true,
            "order": order_to_json(created),
        })),
    ))
}

async fn list_orders(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let orders = state.execution_service.list_orders(100, 0).await?;
    Ok(Json(json!(orders
        .into_iter()
        .map(order_to_json)
        .collect::<Vec<_>>())))
}

async fn list_trades(
    State(state): State<AppState>,
    Query(query): Query<TradeListQuery>,
) -> Result<Json<Value>, AppError> {
    let trades = state
        .portfolio_service
        .list_trades(
            query.strategy_id.as_deref(),
            query.symbol.as_deref(),
            query.limit.unwrap_or(200),
        )
        .await?;

    Ok(Json(json!(trades
        .into_iter()
        .map(execution_trade_to_json)
        .collect::<Vec<_>>())))
}

async fn run_paper_matching(
    State(state): State<AppState>,
    Query(query): Query<PaperSimulationQuery>,
) -> Result<Json<Value>, AppError> {
    if !state.config.trading.paper_trading {
        return Err(AppError::validation(
            "Paper matching is only available when PAPER_TRADING=true",
        ));
    }

    let summary = state
        .execution_service
        .run_paper_matching(query.limit.unwrap_or(100))
        .await?;

    Ok(Json(json!({
        "processed": summary.processed,
        "filled": summary.filled,
        "partially_filled": summary.partially_filled,
        "submitted": summary.submitted,
        "untouched": summary.untouched,
        "unsupported": summary.unsupported,
        "results": summary.results.into_iter().map(|result| json!({
            "order_id": result.order_id.to_string(),
            "symbol": result.symbol,
            "status_before": result.status_before,
            "status_after": result.status_after,
            "action": result.action,
            "detail": result.detail,
            "market_price": result.market_price.and_then(|value| value.to_f64()),
            "fill_price": result.fill_price.and_then(|value| value.to_f64()),
        })).collect::<Vec<_>>(),
    })))
}

async fn cancel_order(
    State(state): State<AppState>,
    axum::extract::Path(order_id): axum::extract::Path<String>,
) -> Result<StatusCode, AppError> {
    let order_id =
        Uuid::parse_str(&order_id).map_err(|_| AppError::validation("Invalid order id"))?;
    state.execution_service.cancel_order(order_id).await?;
    info!("Cancelled order: {}", order_id);
    Ok(StatusCode::NO_CONTENT)
}

async fn get_order_audit(
    State(state): State<AppState>,
    axum::extract::Path(order_id): axum::extract::Path<String>,
    Query(query): Query<OrderAuditQuery>,
) -> Result<Json<Value>, AppError> {
    let order_id =
        Uuid::parse_str(&order_id).map_err(|_| AppError::validation("Invalid order id"))?;
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);

    let entries = state
        .execution_service
        .list_order_audit(order_id, limit, offset)
        .await?;

    Ok(Json(json!({
        "order_id": order_id.to_string(),
        "entries": entries.into_iter().map(|entry| json!({
            "id": entry.id,
            "user_id": entry.user_id,
            "action": entry.action,
            "resource_type": entry.resource_type,
            "resource_id": entry.resource_id,
            "details": entry.details,
            "created_at": entry.created_at.to_rfc3339(),
        })).collect::<Vec<_>>(),
    })))
}

async fn get_portfolio(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let portfolio_id = state.config.trading.default_portfolio_id.clone();
    let portfolio = state
        .portfolio_service
        .get_portfolio_value(&portfolio_id)
        .await?;

    Ok(Json(portfolio_to_json(portfolio)))
}

async fn get_positions(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let portfolio_id = state.config.trading.default_portfolio_id.clone();
    let positions = state
        .portfolio_service
        .list_positions(&portfolio_id)
        .await?;

    let mut map = serde_json::Map::new();
    for position in positions {
        map.insert(position.symbol.clone(), position_to_json(position));
    }

    Ok(Json(Value::Object(map)))
}

async fn get_risk_metrics(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let portfolio_id = state.config.trading.default_portfolio_id.clone();
    let portfolio = state
        .portfolio_service
        .get_portfolio_value(&portfolio_id)
        .await?;
    let metrics = state
        .risk_service
        .monitor_portfolio_risk(&portfolio)
        .await?;

    Ok(Json(json!({
        "base_currency": portfolio_display_currency(&portfolio),
        "portfolio_value": metrics.portfolio_value.to_f64().unwrap_or(0.0),
        "total_exposure": metrics.total_exposure.to_f64().unwrap_or(0.0),
        "leverage": metrics.leverage,
        "var_1d": metrics.var_1d.and_then(|v| v.to_f64()),
        "max_drawdown": metrics.max_drawdown,
        "sharpe_ratio": metrics.sharpe_ratio,
        "calculated_at": metrics.calculated_at.to_rfc3339(),
    })))
}

async fn get_risk_limits(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let limits = state.risk_service.get_risk_limits().await?;

    Ok(Json(json!({
        "max_order_size": limits.max_order_size,
        "max_leverage": limits.max_leverage,
        "max_daily_loss": limits.max_daily_loss.and_then(|v| v.to_f64()),
        "max_portfolio_exposure": limits.max_portfolio_exposure.and_then(|v| v.to_f64()),
        "max_single_stock_weight": limits.max_single_stock_weight,
        "risk_check_enabled": limits.risk_check_enabled,
        "paper_trading": limits.paper_trading,
    })))
}

fn risk_limits_to_json(risk_limits: &RiskLimits) -> Value {
    json!({
        "max_position_size": risk_limits.max_position_size.and_then(|v| v.to_f64()),
        "max_daily_loss": risk_limits.max_daily_loss.and_then(|v| v.to_f64()),
        "max_portfolio_exposure": risk_limits.max_portfolio_exposure.and_then(|v| v.to_f64()),
        "max_single_stock_weight": risk_limits.max_single_stock_weight,
    })
}

fn strategy_config_to_json(config: StrategyConfig) -> Value {
    json!({
        "id": config.id,
        "name": config.name,
        "display_name": config.display_name,
        "description": config.description,
        "parameters": config.parameters,
        "risk_limits": risk_limits_to_json(&config.risk_limits),
        "is_active": config.is_active,
        "created_at": config.created_at.to_rfc3339(),
        "updated_at": config.updated_at.to_rfc3339(),
    })
}

fn build_strategy_config_from_request(req: CreateStrategyRequest) -> StrategyConfig {
    StrategyConfig {
        id: Uuid::new_v4().to_string(),
        name: req.name,
        display_name: req.display_name,
        description: req.description,
        parameters: req
            .parameters
            .unwrap_or_default()
            .as_object()
            .map(|obj| obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default(),
        risk_limits: req.risk_limits.unwrap_or_default(),
        is_active: req.is_active.unwrap_or(true),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn order_to_json(order: crate::types::Order) -> Value {
    let side = match order.side {
        OrderSide::Buy => "Buy",
        OrderSide::Sell => "Sell",
    };

    let order_type = match order.order_type {
        OrderType::Market => "Market",
        OrderType::Limit => "Limit",
        OrderType::Stop => "Stop",
        OrderType::StopLimit => "StopLimit",
    };

    let status = match order.status {
        OrderStatus::Pending => "Pending",
        OrderStatus::Submitted => "Submitted",
        OrderStatus::PartiallyFilled => "PartiallyFilled",
        OrderStatus::Filled => "Filled",
        OrderStatus::Cancelled => "Cancelled",
        OrderStatus::Rejected => "Rejected",
    };

    json!({
        "id": order.id.to_string(),
        "symbol": order.symbol,
        "side": side,
        "quantity": order.quantity,
        "price": order.price.and_then(|v| v.to_f64()),
        "stop_price": order.stop_price.and_then(|v| v.to_f64()),
        "order_type": order_type,
        "time_in_force": order.time_in_force,
        "extended_hours": order.extended_hours,
        "status": status,
        "strategy_id": order.strategy_id,
        "created_at": order.created_at.to_rfc3339(),
        "updated_at": order.updated_at.to_rfc3339(),
        "filled_quantity": order.filled_quantity,
        "average_fill_price": order.average_fill_price.and_then(|v| v.to_f64()),
    })
}

fn execution_trade_to_json(trade: ExecutionTrade) -> Value {
    json!({
        "id": trade.id,
        "order_id": trade.order_id.to_string(),
        "symbol": trade.symbol,
        "side": trade.side,
        "quantity": trade.quantity,
        "price": trade.price.to_f64().unwrap_or(0.0),
        "executed_at": trade.executed_at.to_rfc3339(),
        "portfolio_id": trade.portfolio_id,
        "strategy_id": trade.strategy_id,
    })
}

fn risk_check_to_json(result: &RiskCheckResult) -> Value {
    let (status, message) = result.summary();
    let checks = match result {
        RiskCheckResult::Passed { checks }
        | RiskCheckResult::Warning { checks, .. }
        | RiskCheckResult::Rejected { checks, .. } => checks,
    };

    json!({
        "status": status,
        "message": message,
        "checks": checks.iter().map(|check| {
            json!({
                "rule_code": check.rule_code,
                "check_type": check.check_type,
                "passed": check.passed,
                "message": check.message,
                "severity": format!("{:?}", check.severity).to_lowercase(),
                "actual_value": check.actual_value,
                "threshold_value": check.threshold_value,
            })
        }).collect::<Vec<_>>()
    })
}

fn position_to_json(position: crate::types::Position) -> Value {
    json!({
        "symbol": position.symbol,
        "currency": market_currency_for_symbol(&position.symbol),
        "quantity": position.quantity,
        "average_cost": position.average_cost.to_f64().unwrap_or(0.0),
        "market_value": position.market_value.to_f64().unwrap_or(0.0),
        "unrealized_pnl": position.unrealized_pnl.to_f64().unwrap_or(0.0),
        "realized_pnl": position.realized_pnl.to_f64().unwrap_or(0.0),
        "last_updated": position.last_updated.to_rfc3339(),
    })
}

fn portfolio_to_json(mut portfolio: crate::types::Portfolio) -> Value {
    portfolio.calculate_total_value();
    let base_currency = portfolio_display_currency(&portfolio);

    let positions = portfolio
        .positions
        .into_iter()
        .map(|(symbol, position)| (symbol, position_to_json(position)))
        .collect::<serde_json::Map<String, Value>>();

    json!({
        "id": portfolio.id,
        "name": portfolio.name,
        "base_currency": base_currency,
        "positions": positions,
        "cash_balance": portfolio.cash_balance.to_f64().unwrap_or(0.0),
        "total_value": portfolio.total_value.to_f64().unwrap_or(0.0),
        "unrealized_pnl": portfolio.unrealized_pnl.to_f64().unwrap_or(0.0),
        "realized_pnl": portfolio.realized_pnl.to_f64().unwrap_or(0.0),
        "last_updated": portfolio.last_updated.to_rfc3339(),
    })
}

async fn get_lifecycle_settings(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let settings = state
        .lifecycle_manager
        .read()
        .await
        .get_retention_settings();

    Ok(Json(json!({
        "market_data_retention_days": settings.market_data_retention_days,
        "order_retention_days": settings.order_retention_days,
        "position_retention_days": settings.position_retention_days,
        "market_data_archive_days": settings.market_data_archive_days,
        "order_archive_days": settings.order_archive_days,
    })))
}

async fn update_lifecycle_settings(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> Result<Json<Value>, AppError> {
    let mut manager = state.lifecycle_manager.write().await;

    if let Some(days) = req
        .get("market_data_retention_days")
        .and_then(|v| v.as_i64())
    {
        manager.set_market_data_retention_days(days);
    }
    if let Some(days) = req.get("order_retention_days").and_then(|v| v.as_i64()) {
        manager.set_order_retention_days(days);
    }
    if let Some(days) = req.get("position_retention_days").and_then(|v| v.as_i64()) {
        manager.set_position_retention_days(days);
    }
    if let Some(days) = req.get("market_data_archive_days").and_then(|v| v.as_i64()) {
        manager.set_market_data_archive_days(days);
    }
    if let Some(days) = req.get("order_archive_days").and_then(|v| v.as_i64()) {
        manager.set_order_archive_days(days);
    }

    let settings = manager.get_retention_settings();

    Ok(Json(json!({
        "success": true,
        "settings": settings
    })))
}

async fn run_cleanup(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    info!("Running data cleanup operations");

    let results = state.lifecycle_manager.read().await.run_cleanup().await?;

    let output: Vec<Value> = results
        .into_iter()
        .map(|r| {
            json!({
                "table": r.table,
                "deleted_count": r.deleted_count,
                "cutoff_date": r.cutoff_date.to_rfc3339(),
            })
        })
        .collect();

    Ok(Json(json!({
        "success": true,
        "results": output,
        "executed_at": Utc::now().to_rfc3339(),
    })))
}

async fn run_archival(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    info!("Running data archival operations");

    let results = state.lifecycle_manager.read().await.run_archival().await?;

    let output: Vec<Value> = results
        .into_iter()
        .map(|r| {
            json!({
                "table": r.table,
                "archived_count": r.archived_count,
                "cutoff_date": r.cutoff_date.to_rfc3339(),
                "archived_data_count": r.archived_details.len(),
            })
        })
        .collect();

    Ok(Json(json!({
        "success": true,
        "results": output,
        "executed_at": Utc::now().to_rfc3339(),
    })))
}

#[cfg(test)]
mod http_e2e_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{header, Request};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use sqlx::PgPool;
    use std::env;
    use tower::ServiceExt;

    #[test]
    fn test_interval_normalization() {
        assert_eq!(normalize_history_interval(None), "1d");
        assert_eq!(normalize_history_interval(Some("15min")), "15m");
        assert_eq!(normalize_history_interval(Some("1week")), "1wk");
        assert_eq!(normalize_history_interval(Some("1month")), "1mo");
        assert_eq!(normalize_history_interval(Some("invalid")), "1d");
    }

    #[test]
    fn parse_datetime_keeps_generic_validation_message() {
        let error = parse_datetime("2026/04/01").expect_err("invalid date format should fail");
        assert_eq!(
            error.to_string(),
            "Validation error: Invalid datetime format"
        );
    }

    #[test]
    fn parse_backtest_datetime_uses_backtest_specific_validation_message() {
        let error =
            parse_backtest_datetime("2026/04/01").expect_err("invalid backtest date should fail");
        assert_eq!(
            error.to_string(),
            "Invalid backtest date format. Use YYYY-MM-DD or RFC3339."
        );
    }

    #[test]
    fn validate_backtest_date_range_rejects_end_before_start() {
        let start = parse_backtest_datetime("2026-04-02").expect("start date should parse");
        let end = parse_backtest_datetime("2026-04-01").expect("end date should parse");

        let error = validate_backtest_date_range(start, end)
            .expect_err("backtest date range should be rejected");

        assert_eq!(
            error.to_string(),
            "Invalid backtest date range: end_date must be on or after start_date."
        );
    }

    #[test]
    fn quote_response_marks_degraded_without_failing() {
        let response = market_quote_response(
            "0700.HK",
            "0700.HK",
            json!({
                "symbol": "0700.HK",
                "price": 320.5,
            }),
            "mock_fallback",
            true,
            Some("Using demo fallback".to_string()),
        );

        assert_eq!(response["success"], json!(true));
        assert_eq!(response["meta"]["status"], json!("degraded"));
        assert_eq!(response["meta"]["fallback_used"], json!(true));
        assert_eq!(response["error"], Value::Null);
    }

    #[test]
    fn quote_response_marks_error_when_not_degraded() {
        let response = market_error_response("AAPL", "AAPL", "backend", "upstream timeout");
        assert_eq!(response["success"], json!(false));
        assert_eq!(response["meta"]["status"], json!("error"));
        assert_eq!(response["error"], json!("upstream timeout"));
    }

    #[test]
    fn build_strategy_config_from_request_keeps_display_name_and_parameters() {
        let config = build_strategy_config_from_request(CreateStrategyRequest {
            name: "simple_moving_average".to_string(),
            display_name: Some("港股双均线".to_string()),
            description: Some("demo".to_string()),
            parameters: Some(json!({
                "symbol": "0700.HK",
                "timeframe": "1h",
                "short_period": 8,
                "long_period": 21,
                "initial_capital": 250000,
                "fee_bps": 5,
                "slippage_bps": 2,
                "max_position_fraction": 0.5
            })),
            risk_limits: None,
            is_active: Some(false),
        });

        assert_eq!(config.name, "simple_moving_average");
        assert_eq!(config.display_name.as_deref(), Some("港股双均线"));
        assert_eq!(
            config
                .parameters
                .get("symbol")
                .and_then(|value| value.as_str()),
            Some("0700.HK")
        );
        assert_eq!(
            config
                .parameters
                .get("timeframe")
                .and_then(|value| value.as_str()),
            Some("1h")
        );
        assert_eq!(
            config
                .parameters
                .get("short_period")
                .and_then(|value| value.as_i64()),
            Some(8)
        );
        assert_eq!(config.is_active, false);
    }

    #[test]
    fn strategy_signal_snapshot_json_keeps_manual_confirmation_boundary() {
        let snapshot = crate::types::StrategySignalSnapshot {
            strategy_id: "strategy-1".to_string(),
            strategy_name: Some("SMA Alpha".to_string()),
            symbol: Some("AAPL".to_string()),
            timeframe: Some("1d".to_string()),
            signal_type: Some(crate::types::SignalType::Buy),
            strength: Some(0.82),
            generated_at: Utc::now(),
            source: "strategy_engine_latest_snapshot".to_string(),
            confirmation_state: "manual_review_only".to_string(),
            note: "信号已生成，需人工确认后才可下单".to_string(),
            suggested_order: Some(crate::types::StrategySuggestedOrderDraft {
                symbol: "AAPL".to_string(),
                side: "Buy".to_string(),
                quantity: 100,
                strategy_id: "strategy-1".to_string(),
            }),
        };

        let response = strategy_signal_snapshot_to_json(snapshot);

        assert_eq!(response["strategy_id"], json!("strategy-1"));
        assert_eq!(response["signal_type"], json!("Buy"));
        assert_eq!(response["confirmation_state"], json!("manual_review_only"));
        assert_eq!(
            response["note"],
            json!("信号已生成，需人工确认后才可下单")
        );
        assert_eq!(response["suggested_order"]["strategy_id"], json!("strategy-1"));
        assert_ne!(response["confirmation_state"], json!("auto_execute"));
    }

    #[test]
    fn strategy_execution_overview_separates_research_and_real_execution() {
        let latest_backtest = crate::types::BacktestResult {
            run_id: Some(Uuid::new_v4()),
            experiment_id: None,
            experiment_label: Some("Batch A".to_string()),
            experiment_note: None,
            parameter_version: Some("v1".to_string()),
            strategy_id: "strategy-1".to_string(),
            strategy_name: Some("SMA".to_string()),
            symbol: Some("AAPL".to_string()),
            timeframe: Some("1d".to_string()),
            parameters: Some(std::collections::HashMap::new()),
            trades: Some(Vec::new()),
            equity_curve: Some(Vec::new()),
            start_date: Utc::now() - chrono::Duration::days(30),
            end_date: Utc::now() - chrono::Duration::days(1),
            initial_capital: rust_decimal::Decimal::new(100000, 0),
            final_capital: rust_decimal::Decimal::new(102000, 0),
            total_return: 0.02,
            annualized_return: 0.1,
            sharpe_ratio: 1.1,
            max_drawdown: 0.03,
            win_rate: 0.5,
            total_trades: 4,
            performance_metrics: crate::types::PerformanceMetrics::default(),
            data_quality: None,
            assumptions: None,
            execution_link: None,
            created_at: Some(Utc::now() - chrono::Duration::days(1)),
        };
        let latest_trade = ExecutionTrade {
            id: 42,
            order_id: Uuid::new_v4(),
            symbol: "AAPL".to_string(),
            side: "BUY".to_string(),
            quantity: 10,
            price: rust_decimal::Decimal::new(101, 0),
            executed_at: Utc::now(),
            portfolio_id: Some("paper".to_string()),
            strategy_id: Some("strategy-1".to_string()),
        };

        let overview = build_strategy_execution_overview(
            "strategy-1".to_string(),
            Some("SMA Alpha".to_string()),
            Some(latest_backtest),
            Some(latest_trade),
        );

        assert_eq!(overview.strategy_id, "strategy-1");
        assert_eq!(overview.strategy_name.as_deref(), Some("SMA Alpha"));
        assert_eq!(
            overview
                .latest_backtest
                .as_ref()
                .map(|summary| summary.source.as_str()),
            Some("backtest_runs")
        );
        assert_eq!(
            overview
                .latest_real_trade
                .as_ref()
                .map(|summary| summary.source.as_str()),
            Some("trades")
        );
        assert_eq!(overview.recent_signal.status, "placeholder");
        assert_eq!(
            overview.recent_signal.confirmation_state,
            "manual_review_only"
        );
        assert!(overview.recent_signal.note.contains("信号尚未持久化"));
    }

    #[test]
    fn backtest_json_includes_experiment_metadata() {
        let result = crate::types::BacktestResult {
            run_id: Some(Uuid::new_v4()),
            experiment_id: Some(Uuid::new_v4()),
            experiment_label: Some("Batch A".to_string()),
            experiment_note: Some("note".to_string()),
            parameter_version: Some("v1".to_string()),
            strategy_id: "strategy-1".to_string(),
            strategy_name: Some("SMA".to_string()),
            symbol: Some("AAPL".to_string()),
            timeframe: Some("1d".to_string()),
            parameters: Some(std::collections::HashMap::new()),
            data_quality: Some(crate::types::BacktestDataQuality {
                source_label: "本地行情库".to_string(),
                local_data_hit: true,
                external_data_fallback: false,
                bar_count: 32,
                minimum_required_bars: 20,
                data_insufficient: false,
                missing_intervals: Vec::new(),
                notes: vec!["ok".to_string()],
            }),
            assumptions: Some(crate::types::BacktestAssumptions {
                fee_bps: 5.0,
                slippage_bps: 2.0,
                max_position_fraction: 1.0,
                rebalancing_logic: "双均线交叉触发调仓".to_string(),
                data_source: "本地行情库".to_string(),
            }),
            execution_link: Some(crate::types::BacktestExecutionLink {
                status: "reference_match_only".to_string(),
                reference_scope: "strategy_id + symbol + backtest window".to_string(),
                explicit_link_id: None,
                note: "参考匹配".to_string(),
            }),
            trades: Some(Vec::new()),
            equity_curve: Some(Vec::new()),
            start_date: Utc::now(),
            end_date: Utc::now(),
            initial_capital: rust_decimal::Decimal::new(100000, 0),
            final_capital: rust_decimal::Decimal::new(102000, 0),
            total_return: 0.02,
            annualized_return: 0.1,
            sharpe_ratio: 1.1,
            max_drawdown: 0.03,
            win_rate: 0.5,
            total_trades: 1,
            performance_metrics: crate::types::PerformanceMetrics::default(),
            created_at: Some(Utc::now()),
        };

        let response = backtest_to_json(result);

        assert_eq!(response["experiment_label"], json!("Batch A"));
        assert_eq!(response["parameter_version"], json!("v1"));
        assert!(response["experiment_id"].as_str().is_some());
        assert_eq!(
            response["data_quality"]["source_label"],
            json!("本地行情库")
        );
        assert_eq!(response["assumptions"]["fee_bps"], json!(5.0));
        assert_eq!(
            response["execution_link"]["status"],
            json!("reference_match_only")
        );
    }

    #[test]
    fn health_response_includes_optional_operational_summary() {
        let summary = json!({
            "strategies_total": 3,
            "active_strategies": 2,
            "recent_orders": 4,
            "recent_backtests": 5,
            "recent_trades": 6
        });

        let response = build_health_response(Some(summary.clone()), None);
        assert_eq!(response["status"], json!("healthy"));
        assert!(response["deployed_at"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
        assert_eq!(response["recent_error"], Value::Null);
        assert_eq!(response["summary"], summary);

        let response_without_summary =
            build_health_response(None, Some("summary collection failed".to_string()));
        assert_eq!(response_without_summary["status"], json!("warning"));
        assert_eq!(
            response_without_summary["recent_error"],
            json!("summary collection failed")
        );
        assert_eq!(response_without_summary["summary"], Value::Null);
    }

    async fn setup_e2e_app() -> (axum::Router, PgPool) {
        let config = Arc::new(AppConfig::load().unwrap());
        let db_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(config.database.max_connections)
            .connect(&config.database.url)
            .await
            .unwrap();

        sqlx::migrate!("./migrations").run(&db_pool).await.unwrap();

        let redis_client = redis::Client::open(config.redis.url.as_str()).unwrap();
        let redis_conn = redis_client
            .get_multiplexed_async_connection()
            .await
            .unwrap();
        let event_bus = Arc::new(EventBus::new(redis_client).await.unwrap());

        let data_service = Arc::new(
            DataService::new(db_pool.clone(), redis_conn.clone(), event_bus.clone())
                .await
                .unwrap(),
        );
        let strategy_service = Arc::new(
            StrategyService::new(db_pool.clone(), event_bus.clone())
                .await
                .unwrap(),
        );
        let execution_service = Arc::new(
            ExecutionService::new(db_pool.clone(), event_bus.clone())
                .await
                .unwrap(),
        );
        let portfolio_service = Arc::new(
            PortfolioService::new(db_pool.clone(), event_bus.clone())
                .await
                .unwrap(),
        );
        let risk_service = Arc::new(
            RiskService::new(
                db_pool.clone(),
                event_bus.clone(),
                config.trading.max_order_size,
            )
            .await
            .unwrap(),
        );

        let state = AppState {
            config,
            data_service,
            strategy_service,
            execution_service,
            portfolio_service,
            risk_service,
            event_bus,
            ws_manager: Arc::new(WSManager::new(128)),
            lifecycle_manager: Arc::new(RwLock::new(DataLifecycleManager::new(db_pool.clone()))),
        };

        (create_router(state), db_pool)
    }

    #[tokio::test]
    async fn create_and_update_strategy_return_normalized_stored_config() {
        if env::var("RUN_E2E_TESTS").ok().as_deref() != Some("1") {
            return;
        }

        let (app, _) = setup_e2e_app().await;
        let create_payload = json!({
            "name": "simple_moving_average",
            "display_name": "simple_moving_average",
            "description": "",
            "parameters": {
                "short_period": 8,
                "long_period": 21
            },
            "risk_limits": {},
            "is_active": true
        });

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/strategies")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(serde_json::to_vec(&create_payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let created: Value = serde_json::from_slice(&bytes).unwrap();
        let strategy_id = created["id"].as_str().unwrap().to_string();
        assert_eq!(created["display_name"], json!("SMA 双均线"));
        assert_eq!(created["parameters"]["symbol"], json!("AAPL"));
        assert_eq!(created["parameters"]["timeframe"], json!("1d"));

        let update_payload = json!({
            "display_name": "simple_moving_average",
            "description": "",
            "parameters": {
                "symbol": "0700.HK",
                "timeframe": "1h",
                "short_period": 8,
                "long_period": 21,
                "initial_capital": 250000,
                "fee_bps": 5,
                "slippage_bps": 2,
                "max_position_fraction": 0.5
            },
            "risk_limits": {},
            "is_active": false
        });

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/strategies/{strategy_id}"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(serde_json::to_vec(&update_payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let updated: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(updated["display_name"], json!("SMA 双均线"));
        assert_eq!(updated["parameters"]["symbol"], json!("0700.HK"));
        assert_eq!(updated["parameters"]["timeframe"], json!("1h"));
        assert_eq!(updated["is_active"], json!(false));
    }

    #[tokio::test]
    async fn delete_strategy_clears_related_rows() {
        if env::var("RUN_E2E_TESTS").ok().as_deref() != Some("1") {
            return;
        }

        let (app, db_pool) = setup_e2e_app().await;
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/strategies")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "name": "mean_reversion",
                            "display_name": "Delete Me",
                            "description": "cleanup test",
                            "parameters": {
                                "symbol": "AAPL",
                                "timeframe": "1d",
                                "lookback_period": 20,
                                "threshold": 2.0,
                                "initial_capital": 100000,
                                "fee_bps": 5,
                                "slippage_bps": 2,
                                "max_position_fraction": 1.0
                            },
                            "risk_limits": {},
                            "is_active": true
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let strategy: Value = serde_json::from_slice(&bytes).unwrap();
        let strategy_id = strategy["id"].as_str().unwrap().to_string();

        let order_id = Uuid::new_v4();
        let trade_id = Uuid::new_v4();
        let backtest_id = Uuid::new_v4();
        let executed_at = Utc::now();

        sqlx::query(
            "INSERT INTO orders (order_id, symbol, side, quantity, price, order_type, status, strategy_id, filled_quantity, average_fill_price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(order_id)
        .bind("AAPL")
        .bind("BUY")
        .bind(10_i64)
        .bind(Some(rust_decimal::Decimal::new(1000, 2)))
        .bind("MARKET")
        .bind("PENDING")
        .bind(&strategy_id)
        .bind(0_i64)
        .bind(Option::<rust_decimal::Decimal>::None)
        .execute(&db_pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO trades (order_id, symbol, side, quantity, price, executed_at, portfolio_id, strategy_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(order_id)
        .bind("AAPL")
        .bind("BUY")
        .bind(10_i64)
        .bind(rust_decimal::Decimal::new(1010, 2))
        .bind(executed_at)
        .bind("default")
        .bind(&strategy_id)
        .execute(&db_pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO orders_archive (order_id, symbol, side, quantity, price, order_type, status, strategy_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(order_id.to_string())
        .bind("AAPL")
        .bind("BUY")
        .bind(10_i64)
        .bind(Some(rust_decimal::Decimal::new(1000, 2)))
        .bind("MARKET")
        .bind("PENDING")
        .bind(&strategy_id)
        .execute(&db_pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO trades_archive (trade_id, order_id, symbol, side, quantity, price, executed_at, portfolio_id, strategy_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(trade_id)
        .bind(order_id)
        .bind("AAPL")
        .bind("BUY")
        .bind(10_i64)
        .bind(rust_decimal::Decimal::new(1010, 2))
        .bind(executed_at)
        .bind("default")
        .bind(&strategy_id)
        .execute(&db_pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO performance_metrics (portfolio_id, strategy_id, date, total_pnl, realized_pnl, unrealized_pnl, total_return, sharpe_ratio, max_drawdown) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8)",
        )
        .bind("default")
        .bind(&strategy_id)
        .bind(rust_decimal::Decimal::new(100, 2))
        .bind(rust_decimal::Decimal::new(50, 2))
        .bind(rust_decimal::Decimal::new(50, 2))
        .bind(rust_decimal::Decimal::new(120, 2))
        .bind(rust_decimal::Decimal::new(80, 2))
        .bind(rust_decimal::Decimal::new(30, 2))
        .execute(&db_pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO backtest_runs (id, strategy_id, strategy_name, symbol, timeframe, parameters, trades, equity_curve, start_date, end_date, initial_capital, final_capital, total_return, annualized_return, sharpe_ratio, max_drawdown, win_rate, total_trades, performance_metrics, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)",
        )
        .bind(backtest_id)
        .bind(&strategy_id)
        .bind("Delete Me")
        .bind("AAPL")
        .bind("1d")
        .bind(json!({"symbol":"AAPL","timeframe":"1d"}))
        .bind(json!([]))
        .bind(json!([]))
        .bind(Utc::now())
        .bind(Utc::now())
        .bind(rust_decimal::Decimal::new(100000, 0))
        .bind(rust_decimal::Decimal::new(110000, 0))
        .bind(0.1_f64)
        .bind(0.1_f64)
        .bind(1.2_f64)
        .bind(0.05_f64)
        .bind(0.6_f64)
        .bind(1_i32)
        .bind(json!({"total_pnl":100.0,"realized_pnl":50.0,"unrealized_pnl":50.0}))
        .bind(Utc::now())
        .execute(&db_pool)
        .await
        .unwrap();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/strategies/{strategy_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let table_counts = [
            ("strategies", 0_i64),
            ("orders", 0_i64),
            ("trades", 0_i64),
            ("orders_archive", 0_i64),
            ("trades_archive", 0_i64),
            ("performance_metrics", 0_i64),
            ("backtest_runs", 0_i64),
        ];

        for (table, expected) in table_counts {
            let count: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM {table} WHERE strategy_id = $1"
            ))
            .bind(&strategy_id)
            .fetch_one(&db_pool)
            .await
            .unwrap();
            assert_eq!(count, expected, "table {table} should be empty");
        }
    }

    #[tokio::test]
    async fn e2e_api_smoke() {
        if env::var("RUN_E2E_TESTS").ok().as_deref() != Some("1") {
            return;
        }

        let (app, _) = setup_e2e_app().await;

        let create_strategy_payload = json!({
            "name": "mean_reversion",
            "description": null,
            "parameters": {},
            "risk_limits": {},
            "is_active": true
        });

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/portfolio")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let portfolio_before: Value = serde_json::from_slice(&bytes).unwrap();
        let aapl_before = portfolio_before["positions"]["AAPL"]["quantity"]
            .as_i64()
            .unwrap_or(0);
        let cash_before = portfolio_before["cash_balance"].as_f64().unwrap_or(0.0);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/strategies")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&create_strategy_payload).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let created_strategy: Value = serde_json::from_slice(&bytes).unwrap();
        let strategy_id = created_strategy["id"].as_str().unwrap().to_string();

        let create_order_payload = json!({
            "symbol": "AAPL",
            "side": "Buy",
            "quantity": 1,
            "order_type": "Market",
            "strategy_id": strategy_id
        });

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/orders")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&create_order_payload).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let created_order: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(created_order["accepted"], json!(true));
        assert_eq!(created_order["order"]["status"], json!("Filled"));
        let order_id = created_order["order"]["id"].as_str().unwrap().to_string();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/api/v1/orders/{}", order_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let portfolio_after: Value = serde_json::from_slice(&bytes).unwrap();
        let aapl_after = portfolio_after["positions"]["AAPL"]["quantity"]
            .as_i64()
            .unwrap_or(0);
        let cash_after = portfolio_after["cash_balance"].as_f64().unwrap_or(0.0);
        assert_eq!(aapl_after, aapl_before + 1);
        assert!(cash_after < cash_before);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/portfolio")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/risk/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
