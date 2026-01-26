use crate::error::{AppError, AppResult};
use crate::events::{EventBus, PlatformEvent};
use crate::types::{Portfolio, Position};
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
        let positions = self.get_all_positions(portfolio_id).await?;

        // Update portfolio with current positions
        portfolio.positions.clear();
        for position in positions {
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
