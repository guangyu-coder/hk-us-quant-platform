use crate::error::{AppError, AppResult};
use crate::events::{EventBus, EventHandler, PlatformEvent};
use crate::execution::ExecutionService;
use crate::types::{ExecutionTrade, Order, OrderSide, Portfolio, Position};
use async_trait::async_trait;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Portfolio service for managing positions and P&L
pub struct PortfolioService {
    db_pool: PgPool,
    event_bus: Arc<EventBus>,
}

impl PortfolioService {
    /// Create a new portfolio service
    pub async fn new(db_pool: PgPool, event_bus: Arc<EventBus>) -> AppResult<Self> {
        Ok(Self { db_pool, event_bus })
    }

    /// Update position based on trade execution
    pub async fn update_position(
        &self,
        portfolio_id: &str,
        symbol: &str,
        quantity: i64,
        price: rust_decimal::Decimal,
    ) -> AppResult<Position> {
        info!(
            "Updating position for {} in portfolio {}",
            symbol, portfolio_id
        );

        // Get existing position or create new one
        let mut position = match self.get_position(portfolio_id, symbol).await {
            Ok(pos) => pos,
            Err(_) => Position::new(symbol.to_string(), 0, rust_decimal::Decimal::ZERO),
        };

        // Update position with new trade
        let old_quantity = position.quantity;
        let old_cost = position.average_cost;

        let new_quantity = old_quantity + quantity;

        if new_quantity != 0 {
            // Calculate new average cost
            let old_value = old_cost * rust_decimal::Decimal::from(old_quantity.abs());
            let new_trade_value = price * rust_decimal::Decimal::from(quantity.abs());
            let total_value =
                if (old_quantity > 0 && quantity > 0) || (old_quantity < 0 && quantity < 0) {
                    old_value + new_trade_value
                } else {
                    old_value - new_trade_value
                };

            position.average_cost = total_value / rust_decimal::Decimal::from(new_quantity.abs());
        }

        position.quantity = new_quantity;
        position.last_updated = chrono::Utc::now();

        // Store updated position
        self.store_position(portfolio_id, &position).await?;

        // Publish position updated event
        let event = PlatformEvent::PositionUpdated {
            position: position.clone(),
        };

        if let Err(e) = self.event_bus.publish(event).await {
            warn!("Failed to publish position updated event: {}", e);
        }

        debug!(
            "Position updated for {}: {} shares at avg cost {}",
            symbol, position.quantity, position.average_cost
        );
        Ok(position)
    }

    /// Calculate P&L for all positions in a portfolio
    pub async fn calculate_pnl(
        &self,
        portfolio_id: &str,
        current_prices: std::collections::HashMap<String, rust_decimal::Decimal>,
    ) -> AppResult<rust_decimal::Decimal> {
        debug!("Calculating P&L for portfolio {}", portfolio_id);

        let positions = self.get_all_positions(portfolio_id).await?;
        let mut total_pnl = rust_decimal::Decimal::ZERO;

        for mut position in positions {
            if let Some(&current_price) = current_prices.get(&position.symbol) {
                position.update_market_value(current_price);
                total_pnl += position.unrealized_pnl;

                // Update position in database with new market value
                self.store_position(portfolio_id, &position).await?;
            }
        }

        // Publish P&L calculated event
        let event = PlatformEvent::PnlCalculated {
            portfolio_id: portfolio_id.to_string(),
            total_pnl,
        };

        if let Err(e) = self.event_bus.publish(event).await {
            warn!("Failed to publish P&L calculated event: {}", e);
        }

        info!("Total P&L for portfolio {}: {}", portfolio_id, total_pnl);
        Ok(total_pnl)
    }

    /// Get portfolio value
    pub async fn get_portfolio_value(&self, portfolio_id: &str) -> AppResult<Portfolio> {
        debug!("Getting portfolio value for {}", portfolio_id);

        // Get portfolio from database
        let mut portfolio = self.get_portfolio(portfolio_id).await?;

        // Get all positions
        let mut positions = self.get_all_positions(portfolio_id).await?;
        let symbols: Vec<String> = positions
            .iter()
            .map(|position| position.symbol.clone())
            .collect();
        let latest_prices = self.load_latest_market_prices(&symbols).await?;

        // Update portfolio with current positions
        portfolio.positions.clear();
        for mut position in positions.drain(..) {
            let current_price = latest_prices
                .get(&position.symbol)
                .copied()
                .unwrap_or(position.average_cost);
            position.update_market_value(current_price);

            portfolio
                .positions
                .insert(position.symbol.clone(), position);
        }

        // Calculate total value
        portfolio.calculate_total_value();

        Ok(portfolio)
    }

    pub async fn list_positions(&self, portfolio_id: &str) -> AppResult<Vec<Position>> {
        self.get_all_positions(portfolio_id).await
    }

    pub async fn list_trades(
        &self,
        strategy_id: Option<&str>,
        symbol: Option<&str>,
        limit: i64,
    ) -> AppResult<Vec<ExecutionTrade>> {
        let safe_limit = limit.clamp(1, 500);

        let mut query = String::from(
            "SELECT id, order_id, symbol, side, quantity, price, executed_at, portfolio_id, strategy_id \
             FROM trades",
        );
        let mut where_clauses = Vec::new();
        let mut bind_index = 1;

        if strategy_id
            .filter(|value| !value.trim().is_empty())
            .is_some()
        {
            where_clauses.push(format!("strategy_id = ${bind_index}"));
            bind_index += 1;
        }

        if symbol.filter(|value| !value.trim().is_empty()).is_some() {
            where_clauses.push(format!("symbol = ${bind_index}"));
        }

        if !where_clauses.is_empty() {
            query.push_str(" WHERE ");
            query.push_str(&where_clauses.join(" AND "));
        }

        query.push_str(" ORDER BY executed_at DESC LIMIT ");
        query.push_str(&safe_limit.to_string());

        let mut sql = sqlx::query_as::<_, ExecutionTradeRow>(&query);

        if let Some(strategy_id) = strategy_id.filter(|value| !value.trim().is_empty()) {
            sql = sql.bind(strategy_id.trim());
        }

        if let Some(symbol) = symbol.filter(|value| !value.trim().is_empty()) {
            sql = sql.bind(symbol.trim());
        }

        let rows = sql
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;
        Ok(rows.into_iter().map(ExecutionTrade::from).collect())
    }

    pub async fn apply_order_fill(
        &self,
        portfolio_id: &str,
        order: &Order,
        filled_quantity: i64,
        fill_price: Decimal,
    ) -> AppResult<Position> {
        if filled_quantity <= 0 {
            return Err(AppError::validation("Filled quantity must be positive"));
        }

        let signed_quantity = match order.side {
            OrderSide::Buy => filled_quantity,
            OrderSide::Sell => -filled_quantity,
        };

        let existing_position = self
            .get_position(portfolio_id, &order.symbol)
            .await
            .unwrap_or_else(|_| Position::new(order.symbol.clone(), 0, Decimal::ZERO));

        let realized_pnl_delta =
            self.calculate_realized_pnl_delta(&existing_position, signed_quantity, fill_price);
        let cash_delta = Decimal::from(-signed_quantity) * fill_price;

        self.store_trade_fill(portfolio_id, order, filled_quantity, fill_price)
            .await?;
        self.update_portfolio_ledger(portfolio_id, cash_delta, realized_pnl_delta)
            .await?;

        let mut position = self
            .update_position(portfolio_id, &order.symbol, signed_quantity, fill_price)
            .await?;
        position.update_market_value(fill_price);

        Ok(position)
    }

    pub async fn get_pnl_history(
        &self,
        portfolio_id: &str,
        days: i64,
    ) -> AppResult<Vec<PortfolioPnlPoint>> {
        let safe_days = days.clamp(1, 365);

        let query = r#"
            SELECT
                date,
                SUM(total_pnl) AS total_pnl,
                SUM(realized_pnl) AS realized_pnl,
                SUM(unrealized_pnl) AS unrealized_pnl
            FROM performance_metrics
            WHERE portfolio_id = $1
              AND date >= CURRENT_DATE - ($2::int - 1)
            GROUP BY date
            ORDER BY date ASC
        "#;

        let rows = sqlx::query_as::<_, PortfolioPnlPointRow>(query)
            .bind(portfolio_id)
            .bind(safe_days as i32)
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(rows.into_iter().map(PortfolioPnlPoint::from).collect())
    }

    /// Generate daily report
    pub async fn generate_daily_report(
        &self,
        portfolio_id: &str,
        date: chrono::DateTime<chrono::Utc>,
    ) -> AppResult<serde_json::Value> {
        info!(
            "Generating daily report for portfolio {} on {}",
            portfolio_id,
            date.date_naive()
        );

        let portfolio = self.get_portfolio_value(portfolio_id).await?;

        let report = serde_json::json!({
            "portfolio_id": portfolio_id,
            "date": date.date_naive(),
            "total_value": portfolio.total_value,
            "cash_balance": portfolio.cash_balance,
            "unrealized_pnl": portfolio.unrealized_pnl,
            "realized_pnl": portfolio.realized_pnl,
            "positions": portfolio.positions.len(),
            "generated_at": chrono::Utc::now()
        });

        Ok(report)
    }

    /// Get position for a specific symbol in a portfolio
    async fn get_position(&self, portfolio_id: &str, symbol: &str) -> AppResult<Position> {
        let query = r#"
            SELECT symbol, quantity, average_cost, last_updated
            FROM positions
            WHERE portfolio_id = $1 AND symbol = $2
        "#;

        let row = sqlx::query_as::<_, PositionRow>(query)
            .bind(portfolio_id)
            .bind(symbol)
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => AppError::not_found(format!(
                    "Position for {} in portfolio {}",
                    symbol, portfolio_id
                )),
                _ => AppError::Database(e),
            })?;

        Ok(row.into())
    }

    /// Get all positions in a portfolio
    async fn get_all_positions(&self, portfolio_id: &str) -> AppResult<Vec<Position>> {
        let query = r#"
            SELECT symbol, quantity, average_cost, last_updated
            FROM positions
            WHERE portfolio_id = $1
        "#;

        let rows = sqlx::query_as::<_, PositionRow>(query)
            .bind(portfolio_id)
            .fetch_all(&self.db_pool)
            .await
            .map_err(|e| AppError::Database(e))?;

        let positions: Vec<Position> = rows.into_iter().map(|row| row.into()).collect();
        Ok(positions)
    }

    async fn load_latest_market_prices(
        &self,
        symbols: &[String],
    ) -> AppResult<std::collections::HashMap<String, Decimal>> {
        if symbols.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        let query = r#"
            SELECT DISTINCT ON (symbol) symbol, price
            FROM market_data
            WHERE symbol = ANY($1)
            ORDER BY symbol, timestamp DESC
        "#;

        let rows = sqlx::query_as::<_, LatestPriceRow>(query)
            .bind(symbols)
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(rows
            .into_iter()
            .map(|row| (row.symbol, row.price))
            .collect())
    }

    async fn update_portfolio_ledger(
        &self,
        portfolio_id: &str,
        cash_delta: Decimal,
        realized_pnl_delta: Decimal,
    ) -> AppResult<()> {
        let query = r#"
            UPDATE portfolios
            SET cash_balance = cash_balance + $1,
                realized_pnl = realized_pnl + $2,
                last_updated = NOW()
            WHERE id = $3
        "#;

        sqlx::query(query)
            .bind(cash_delta)
            .bind(realized_pnl_delta)
            .bind(portfolio_id)
            .execute(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(())
    }

    async fn store_trade_fill(
        &self,
        portfolio_id: &str,
        order: &Order,
        filled_quantity: i64,
        fill_price: Decimal,
    ) -> AppResult<()> {
        let side = match order.side {
            OrderSide::Buy => "BUY",
            OrderSide::Sell => "SELL",
        };

        let query = r#"
            INSERT INTO trades (order_id, symbol, side, quantity, price, portfolio_id, strategy_id, executed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        "#;

        sqlx::query(query)
            .bind(order.id)
            .bind(&order.symbol)
            .bind(side)
            .bind(filled_quantity)
            .bind(fill_price)
            .bind(portfolio_id)
            .bind(&order.strategy_id)
            .execute(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(())
    }

    fn calculate_realized_pnl_delta(
        &self,
        existing_position: &Position,
        signed_quantity: i64,
        fill_price: Decimal,
    ) -> Decimal {
        if existing_position.quantity == 0 || signed_quantity == 0 {
            return Decimal::ZERO;
        }

        if existing_position.quantity > 0 && signed_quantity < 0 {
            let closed_quantity = existing_position.quantity.min(signed_quantity.abs());
            return (fill_price - existing_position.average_cost) * Decimal::from(closed_quantity);
        }

        if existing_position.quantity < 0 && signed_quantity > 0 {
            let closed_quantity = existing_position.quantity.abs().min(signed_quantity);
            return (existing_position.average_cost - fill_price) * Decimal::from(closed_quantity);
        }

        Decimal::ZERO
    }

    /// Store position in database
    async fn store_position(&self, portfolio_id: &str, position: &Position) -> AppResult<()> {
        let query = r#"
            INSERT INTO positions (portfolio_id, symbol, quantity, average_cost, last_updated)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (portfolio_id, symbol) DO UPDATE SET
                quantity = EXCLUDED.quantity,
                average_cost = EXCLUDED.average_cost,
                last_updated = EXCLUDED.last_updated
        "#;

        sqlx::query(query)
            .bind(portfolio_id)
            .bind(&position.symbol)
            .bind(position.quantity)
            .bind(position.average_cost)
            .bind(position.last_updated)
            .execute(&self.db_pool)
            .await
            .map_err(|e| AppError::Database(e))?;

        Ok(())
    }

    /// Get portfolio from database
    async fn get_portfolio(&self, portfolio_id: &str) -> AppResult<Portfolio> {
        let query = r#"
            SELECT id, name, cash_balance, total_value, unrealized_pnl, realized_pnl, last_updated
            FROM portfolios
            WHERE id = $1
        "#;

        let row = sqlx::query_as::<_, PortfolioRow>(query)
            .bind(portfolio_id)
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => {
                    AppError::not_found(format!("Portfolio {}", portfolio_id))
                }
                _ => AppError::Database(e),
            })?;

        Ok(row.into())
    }
}

/// Database row structure for positions
#[derive(sqlx::FromRow)]
struct PositionRow {
    symbol: String,
    quantity: i64,
    average_cost: rust_decimal::Decimal,
    last_updated: chrono::DateTime<chrono::Utc>,
}

#[derive(sqlx::FromRow)]
struct ExecutionTradeRow {
    id: i64,
    order_id: uuid::Uuid,
    symbol: String,
    side: String,
    quantity: i64,
    price: Decimal,
    executed_at: chrono::DateTime<chrono::Utc>,
    portfolio_id: Option<String>,
    strategy_id: Option<String>,
}

impl From<PositionRow> for Position {
    fn from(row: PositionRow) -> Self {
        Position {
            symbol: row.symbol,
            quantity: row.quantity,
            average_cost: row.average_cost,
            market_value: rust_decimal::Decimal::ZERO,
            unrealized_pnl: rust_decimal::Decimal::ZERO,
            realized_pnl: rust_decimal::Decimal::ZERO,
            last_updated: row.last_updated,
        }
    }
}

impl From<ExecutionTradeRow> for ExecutionTrade {
    fn from(row: ExecutionTradeRow) -> Self {
        Self {
            id: row.id,
            order_id: row.order_id,
            symbol: row.symbol,
            side: row.side,
            quantity: row.quantity,
            price: row.price,
            executed_at: row.executed_at,
            portfolio_id: row.portfolio_id,
            strategy_id: row.strategy_id,
        }
    }
}

/// Database row structure for portfolios
#[derive(sqlx::FromRow)]
struct PortfolioRow {
    id: String,
    name: String,
    cash_balance: rust_decimal::Decimal,
    total_value: rust_decimal::Decimal,
    unrealized_pnl: rust_decimal::Decimal,
    realized_pnl: rust_decimal::Decimal,
    last_updated: chrono::DateTime<chrono::Utc>,
}

impl From<PortfolioRow> for Portfolio {
    fn from(row: PortfolioRow) -> Self {
        Portfolio {
            id: row.id,
            name: row.name,
            positions: std::collections::HashMap::new(),
            cash_balance: row.cash_balance,
            total_value: row.total_value,
            unrealized_pnl: row.unrealized_pnl,
            realized_pnl: row.realized_pnl,
            last_updated: row.last_updated,
        }
    }
}

#[derive(sqlx::FromRow)]
struct LatestPriceRow {
    symbol: String,
    price: Decimal,
}

#[derive(Debug, Clone)]
pub struct PortfolioPnlPoint {
    pub date: NaiveDate,
    pub total_pnl: Decimal,
    pub realized_pnl: Decimal,
    pub unrealized_pnl: Decimal,
}

#[derive(sqlx::FromRow)]
struct PortfolioPnlPointRow {
    date: NaiveDate,
    total_pnl: Decimal,
    realized_pnl: Decimal,
    unrealized_pnl: Decimal,
}

impl From<PortfolioPnlPointRow> for PortfolioPnlPoint {
    fn from(row: PortfolioPnlPointRow) -> Self {
        Self {
            date: row.date,
            total_pnl: row.total_pnl,
            realized_pnl: row.realized_pnl,
            unrealized_pnl: row.unrealized_pnl,
        }
    }
}

pub struct PortfolioExecutionHandler {
    portfolio_service: Arc<PortfolioService>,
    execution_service: Arc<ExecutionService>,
    portfolio_id: String,
}

impl PortfolioExecutionHandler {
    pub fn new(
        portfolio_service: Arc<PortfolioService>,
        execution_service: Arc<ExecutionService>,
        portfolio_id: String,
    ) -> Self {
        Self {
            portfolio_service,
            execution_service,
            portfolio_id,
        }
    }
}

#[async_trait]
impl EventHandler for PortfolioExecutionHandler {
    async fn handle_event(&self, event: &PlatformEvent) -> AppResult<()> {
        match event {
            PlatformEvent::OrderFilled {
                order_id,
                filled_quantity,
                fill_price,
            } => {
                let order = self.execution_service.get_order(*order_id).await?;
                self.portfolio_service
                    .apply_order_fill(&self.portfolio_id, &order, *filled_quantity, *fill_price)
                    .await?;
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn interested_events(&self) -> Vec<&'static str> {
        vec!["order_filled"]
    }
}
