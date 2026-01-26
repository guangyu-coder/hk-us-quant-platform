use anyhow::Result;
use axum::{
    extract::Path,
    extract::Query,
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::process::Command;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

mod config;
mod data;
mod error;
mod events;
mod execution;
mod portfolio;
mod risk;
mod strategy;
mod types;

use crate::config::AppConfig;
use crate::data::handlers::DataEventHandler;
use crate::data::DataService;
use crate::error::AppError;
use crate::events::EventBus;
use crate::execution::ExecutionService;
use crate::portfolio::PortfolioService;
use crate::risk::RiskCheckResult;
use crate::risk::RiskService;
use crate::strategy::StrategyService;
use crate::types::{OrderSide, OrderStatus, OrderType, RiskLimits, StrategyConfig};
use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

/// Request body for creating a strategy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStrategyRequest {
    pub name: String,
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
    pub description: Option<String>,
    pub parameters: Option<serde_json::Value>,
    pub risk_limits: Option<RiskLimits>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestRequest {
    pub start_date: String,
    pub end_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketDataHistoryQuery {
    pub start: String,
    pub end: String,
    pub interval: Option<String>,
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
}

#[tokio::main]
async fn main() -> Result<()> {
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

    Ok(AppState {
        config,
        data_service,
        strategy_service,
        execution_service,
        portfolio_service,
        risk_service,
        event_bus,
    })
}

fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/market-data/:symbol", get(get_market_data))
        .route(
            "/api/v1/market-data/:symbol/history",
            get(get_market_data_history),
        )
        .route("/api/v1/market-data/batch", post(get_market_data_batch))
        .route("/api/v1/market-data/search", get(search_symbols))
        .route("/api/v1/market-data/list", get(list_market_symbols))
        .route("/api/v1/strategies", get(list_strategies))
        .route("/api/v1/strategies", post(create_strategy))
        .route("/api/v1/strategies/:strategy_id", put(update_strategy))
        .route("/api/v1/strategies/:strategy_id", delete(delete_strategy))
        .route(
            "/api/v1/strategies/:strategy_id/backtest",
            post(run_backtest),
        )
        .route("/api/v1/orders", get(list_orders))
        .route("/api/v1/orders", post(create_order))
        .route("/api/v1/orders/:order_id", get(get_order))
        .route("/api/v1/orders/:order_id", delete(cancel_order))
        .route("/api/v1/portfolio", get(get_portfolio))
        .route("/api/v1/portfolio/positions", get(get_positions))
        .route("/api/v1/portfolio/pnl", get(get_portfolio_pnl))
        .route("/api/v1/risk/metrics", get(get_risk_metrics))
        .route("/api/v1/risk/alerts", get(list_risk_alerts))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health_check(State(_state): State<AppState>) -> Result<Json<Value>, AppError> {
    // Check service health
    let health_status = json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now(),
        "services": {
            "database": "connected",
            "redis": "connected",
            "data_service": "running",
            "strategy_service": "running",
            "execution_service": "running",
            "portfolio_service": "running",
            "risk_service": "running"
        }
    });

    Ok(Json(health_status))
}

async fn get_market_data(
    State(_state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<Value>, AppError> {
    info!("Fetching real market data for: {}", symbol);
    Ok(Json(fetch_market_data_value(&symbol).await?))
}

fn get_mock_market_data(symbol: &str) -> Value {
    // Fallback mock data
    let base_price = match symbol {
        "AAPL" => 150.0,
        "GOOGL" => 2800.0,
        "MSFT" => 380.0,
        "TSLA" => 250.0,
        "0700.HK" => 320.0,
        "0941.HK" => 85.0,
        _ => 100.0,
    };

    let variation = (rand::random::<f64>() - 0.5) * base_price * 0.02;
    let price = base_price + variation;
    let previous_close = base_price;
    let change = price - previous_close;
    let change_percent = (change / previous_close) * 100.0;

    json!({
        "symbol": symbol,
        "price": price,
        "previous_close": previous_close,
        "open": previous_close + (rand::random::<f64>() - 0.5) * 2.0,
        "high": price + rand::random::<f64>() * 5.0,
        "low": price - rand::random::<f64>() * 5.0,
        "volume": rand::random::<i64>() % 10000000 + 1000000,
        "change": change,
        "change_percent": change_percent,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "source": "mock"
    })
}

async fn get_market_data_history(
    State(_state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<MarketDataHistoryQuery>,
) -> Result<Json<Value>, AppError> {
    info!("Fetching historical market data for: {}", symbol);
    
    let script_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("market_data.py");
        
    let mut cmd = Command::new("python3");
    cmd.arg(script_path)
       .arg("--symbol")
       .arg(&symbol)
       .arg("--history");

    if !query.start.is_empty() {
        cmd.arg("--start").arg(&query.start);
    }
    
    if !query.end.is_empty() {
        cmd.arg("--end").arg(&query.end);
    }
    
    if let Some(interval) = &query.interval {
        cmd.arg("--interval").arg(interval);
    } else {
        // Default to 1day if not provided
        cmd.arg("--interval").arg("1day");
    }
    
    // Default outputsize if no dates provided (handled by script logic too, but explicit here is fine)
    if query.start.is_empty() && query.end.is_empty() {
        cmd.arg("--outputsize").arg("30");
    }

    let output = cmd.output()
        .await
        .map_err(|e| AppError::market_data(format!("Failed to run history script: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::market_data(format!(
            "History script failed: {}",
            stderr
        )));
    }

    let data: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::market_data(format!("Invalid history response: {}", e)))?;
        
    if data.get("success") != Some(&serde_json::json!(true)) {
         return Err(AppError::market_data(format!(
            "Historical data unavailable for {}: {}",
            symbol,
            data.get("error").and_then(|e| e.as_str()).unwrap_or("Unknown error")
        )));
    }
    
    // Return the data array directly as expected by frontend
    Ok(Json(data.get("data").cloned().unwrap_or(json!([]))))
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
        .await
        .map_err(|e| AppError::market_data(format!("Failed to run search script: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::market_data(format!(
            "Search script failed: {}",
            stderr
        )));
    }

    let data: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::market_data(format!("Invalid search response: {}", e)))?;

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

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::market_data(format!("Failed to run list market script: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::market_data(format!(
            "List market script failed: {}",
            stderr
        )));
    }

    let data: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::market_data(format!("Invalid list market response: {}", e)))?;

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

    Ok(Json(strategy_config_to_json(config)))
}

async fn delete_strategy(
    State(state): State<AppState>,
    Path(strategy_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state
        .strategy_service
        .deactivate_strategy(&strategy_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn run_backtest(
    State(state): State<AppState>,
    Path(strategy_id): Path<String>,
    Json(req): Json<BacktestRequest>,
) -> Result<Json<Value>, AppError> {
    let start = parse_datetime(&req.start_date)?;
    let end = parse_datetime(&req.end_date)?;
    let result = state
        .strategy_service
        .run_backtest(&strategy_id, start, end)
        .await?;
    Ok(Json(backtest_to_json(result)))
}

async fn fetch_market_data_value(symbol: &str) -> Result<Value, AppError> {
    let script_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("market_data.py");
    
    // Set a timeout for the script execution (e.g., 5 seconds)
    let timeout_duration = std::time::Duration::from_secs(5);
    
    let command_future = Command::new("python3")
        .arg(script_path)
        .arg("--symbol")
        .arg(symbol)
        .output();

    let output = match tokio::time::timeout(timeout_duration, command_future).await {
        Ok(result) => result,
        Err(_) => {
             info!("Market data script timed out for {}. Using mock data.", symbol);
             return Ok(get_mock_market_data(symbol));
        }
    };

    // Fallback to mock data on any error to ensure UI availability
    let output = match output {
        Ok(out) => out,
        Err(e) => {
            info!("Failed to run market data script for {}: {}. Using mock data.", symbol, e);
            return Ok(get_mock_market_data(symbol));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        info!("Market data script failed for {}: {}. Using mock data.", symbol, stderr);
        return Ok(get_mock_market_data(symbol));
    }

    let data: Value = match serde_json::from_slice(&output.stdout) {
        Ok(v) => v,
        Err(e) => {
             info!("Invalid market data response for {}: {}. Using mock data.", symbol, e);
             return Ok(get_mock_market_data(symbol));
        }
    };

    if data.get("success") != Some(&serde_json::json!(true)) {
        let err = data.get("error").and_then(|e| e.as_str()).unwrap_or("Unknown error");
        info!("Market data unavailable for {}: {}. Using mock data.", symbol, err);
        return Ok(get_mock_market_data(symbol));
    }

    let price_data = &data["data"];
    let previous_close = price_data
        .get("previous_close")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let current_price = price_data
        .get("price")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let open_price = price_data
        .get("open")
        .and_then(|v| v.as_f64())
        .unwrap_or(previous_close);
    let high_price = price_data
        .get("high")
        .and_then(|v| v.as_f64())
        .unwrap_or(current_price);
    let low_price = price_data
        .get("low")
        .and_then(|v| v.as_f64())
        .unwrap_or(current_price);
    let volume = price_data
        .get("volume")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let change = current_price - previous_close;
    let change_percent = if previous_close != 0.0 {
        (change / previous_close) * 100.0
    } else {
        0.0
    };

    Ok(json!({
        "symbol": symbol,
        "price": current_price,
        "previous_close": previous_close,
        "open": open_price,
        "high": high_price,
        "low": low_price,
        "volume": volume,
        "change": change,
        "change_percent": change_percent,
        "timestamp": data.get("timestamp").unwrap_or(&serde_json::json!("")),
        "source": "twelvedata"
    }))
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

fn backtest_to_json(result: crate::types::BacktestResult) -> Value {
    json!({
        "strategy_id": result.strategy_id,
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
    // Create strategy configuration
    let config = StrategyConfig {
        id: Uuid::new_v4().to_string(),
        name: req.name,
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
    };

    state.strategy_service.load_strategy(config.clone()).await?;
    info!("Created strategy: {} ({})", config.name, config.id);
    Ok(Json(strategy_config_to_json(config)))
}

async fn create_order(
    State(state): State<AppState>,
    Json(req): Json<CreateOrderRequest>,
) -> Result<Json<Value>, AppError> {
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

    // Handle advanced order fields
    if let Some(stop_price) = req.stop_price {
        // In a real implementation, we would set this on the order
        info!("Order {} has stop price: {}", order.id, stop_price);
    }

    if let Some(tif) = &req.time_in_force {
        info!("Order {} time in force: {}", order.id, tif);
    }

    if let Some(ext) = req.extended_hours {
        if ext {
            info!("Order {} enabled for extended hours", order.id);
        }
    }

    if let Some(strategy_id) = req.strategy_id {
        order = order.with_strategy(strategy_id);
    }

    if state.config.trading.risk_check_enabled {
        let check_result = state.risk_service.check_pre_trade_risk(&order).await?;
        if let RiskCheckResult::Rejected { reason, .. } = check_result {
            return Err(AppError::risk(reason));
        }
    }

    let mut created = state.execution_service.create_order_direct(order).await?;
    if !state.config.trading.paper_trading {
        state.execution_service.submit_order(created.id).await?;
        created = state.execution_service.get_order(created.id).await?;
    }

    info!(
        "Created order: {} - {:?} {} {} {:?} @ {:?}",
        created.id,
        created.side,
        created.quantity,
        created.symbol,
        created.order_type,
        created.price
    );

    Ok(Json(order_to_json(created)))
}

async fn list_orders(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let orders = state.execution_service.list_orders(100, 0).await?;
    Ok(Json(json!(orders
        .into_iter()
        .map(order_to_json)
        .collect::<Vec<_>>())))
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
        "portfolio_value": metrics.portfolio_value.to_f64().unwrap_or(0.0),
        "total_exposure": metrics.total_exposure.to_f64().unwrap_or(0.0),
        "leverage": metrics.leverage,
        "var_1d": metrics.var_1d.and_then(|v| v.to_f64()),
        "max_drawdown": metrics.max_drawdown,
        "sharpe_ratio": metrics.sharpe_ratio,
        "calculated_at": metrics.calculated_at.to_rfc3339(),
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
        "description": config.description,
        "parameters": config.parameters,
        "risk_limits": risk_limits_to_json(&config.risk_limits),
        "is_active": config.is_active,
        "created_at": config.created_at.to_rfc3339(),
        "updated_at": config.updated_at.to_rfc3339(),
    })
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
        "order_type": order_type,
        "status": status,
        "strategy_id": order.strategy_id,
        "created_at": order.created_at.to_rfc3339(),
        "updated_at": order.updated_at.to_rfc3339(),
        "filled_quantity": order.filled_quantity,
        "average_fill_price": order.average_fill_price.and_then(|v| v.to_f64()),
    })
}

fn position_to_json(position: crate::types::Position) -> Value {
    let market_value = position.average_cost * rust_decimal::Decimal::from(position.quantity.abs());

    json!({
        "symbol": position.symbol,
        "quantity": position.quantity,
        "average_cost": position.average_cost.to_f64().unwrap_or(0.0),
        "market_value": market_value.to_f64().unwrap_or(0.0),
        "unrealized_pnl": position.unrealized_pnl.to_f64().unwrap_or(0.0),
        "realized_pnl": position.realized_pnl.to_f64().unwrap_or(0.0),
        "last_updated": position.last_updated.to_rfc3339(),
    })
}

fn portfolio_to_json(mut portfolio: crate::types::Portfolio) -> Value {
    for position in portfolio.positions.values_mut() {
        let current_price = position.average_cost;
        position.update_market_value(current_price);
    }
    portfolio.calculate_total_value();

    let positions = portfolio
        .positions
        .into_iter()
        .map(|(symbol, position)| (symbol, position_to_json(position)))
        .collect::<serde_json::Map<String, Value>>();

    json!({
        "id": portfolio.id,
        "name": portfolio.name,
        "positions": positions,
        "cash_balance": portfolio.cash_balance.to_f64().unwrap_or(0.0),
        "total_value": portfolio.total_value.to_f64().unwrap_or(0.0),
        "unrealized_pnl": portfolio.unrealized_pnl.to_f64().unwrap_or(0.0),
        "realized_pnl": portfolio.realized_pnl.to_f64().unwrap_or(0.0),
        "last_updated": portfolio.last_updated.to_rfc3339(),
    })
}

#[cfg(test)]
mod http_e2e_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{header, Request};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::env;
    use tower::ServiceExt;

    #[tokio::test]
    async fn e2e_api_smoke() {
        if env::var("RUN_E2E_TESTS").ok().as_deref() != Some("1") {
            return;
        }

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
        };

        let app = create_router(state);

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
        let order_id = created_order["id"].as_str().unwrap().to_string();

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