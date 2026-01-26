use crate::error::{AppError, AppResult};
use crate::events::{EventBus, PlatformEvent};
use crate::types::{Order, OrderStatus, Signal};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Execution service for managing order execution
pub struct ExecutionService {
    db_pool: PgPool,
    event_bus: Arc<EventBus>,
}

impl ExecutionService {
    /// Create a new execution service
    pub async fn new(db_pool: PgPool, event_bus: Arc<EventBus>) -> AppResult<Self> {
        Ok(Self { db_pool, event_bus })
    }

    /// Validate a trading signal
    pub async fn validate_signal(&self, signal: &Signal) -> AppResult<bool> {
        debug!("Validating signal for {}", signal.symbol);

        // Basic signal validation
        if signal.symbol.is_empty() {
            return Err(AppError::validation("Signal symbol cannot be empty"));
        }

        if signal.strength < 0.0 || signal.strength > 1.0 {
            return Err(AppError::validation(
                "Signal strength must be between 0.0 and 1.0",
            ));
        }

        // Additional validation logic would go here
        // - Check market hours
        // - Validate symbol exists
        // - Check strategy permissions

        Ok(true)
    }

    /// Create an order from a trading signal
    pub async fn create_order(&self, signal: &Signal) -> AppResult<Order> {
        info!("Creating order from signal for {}", signal.symbol);

        // Validate signal first
        self.validate_signal(signal).await?;

        // Convert signal to order
        let side = match signal.signal_type {
            crate::types::SignalType::Buy => crate::types::OrderSide::Buy,
            crate::types::SignalType::Sell => crate::types::OrderSide::Sell,
            crate::types::SignalType::Hold => {
                return Err(AppError::validation("Cannot create order from HOLD signal"));
            }
        };

        // Calculate order quantity based on signal strength
        // This is a simplified calculation - real implementation would consider:
        // - Portfolio size
        // - Risk limits
        // - Position sizing rules
        let base_quantity = 100;
        let quantity = (base_quantity as f64 * signal.strength) as i64;

        if quantity <= 0 {
            return Err(AppError::validation("Order quantity must be positive"));
        }

        let order = Order::new(
            signal.symbol.clone(),
            side,
            quantity,
            crate::types::OrderType::Market,
        )
        .with_strategy(signal.strategy_id.clone());

        // Store order in database
        self.store_order(&order).await?;

        // Publish order created event
        let event = PlatformEvent::OrderCreated {
            order: order.clone(),
        };

        if let Err(e) = self.event_bus.publish(event).await {
            warn!("Failed to publish order created event: {}", e);
        }

        debug!("Order {} created successfully", order.id);
        Ok(order)
    }

    /// Submit an order to the broker
    pub async fn submit_order(&self, order_id: Uuid) -> AppResult<()> {
        info!("Submitting order {}", order_id);

        // Get order from database
        let mut order = self.get_order_by_id(order_id).await?;

        // Check if order can be submitted
        if order.status != OrderStatus::Pending {
            return Err(AppError::execution(format!(
                "Order {} cannot be submitted in status {:?}",
                order_id, order.status
            )));
        }

        // Submit to broker (placeholder implementation)
        match self.submit_to_broker(&order).await {
            Ok(_) => {
                order.status = OrderStatus::Submitted;
                self.update_order_status(&order).await?;

                info!("Order {} submitted successfully", order_id);
            }
            Err(e) => {
                order.status = OrderStatus::Rejected;
                self.update_order_status(&order).await?;

                let event = PlatformEvent::OrderRejected {
                    order_id,
                    reason: e.to_string(),
                };

                if let Err(e) = self.event_bus.publish(event).await {
                    warn!("Failed to publish order rejected event: {}", e);
                }

                return Err(AppError::execution(format!(
                    "Order submission failed: {}",
                    e
                )));
            }
        }

        Ok(())
    }

    /// Cancel an order
    pub async fn cancel_order(&self, order_id: Uuid) -> AppResult<()> {
        info!("Cancelling order {}", order_id);

        let mut order = self.get_order_by_id(order_id).await?;

        // Check if order can be cancelled
        match order.status {
            OrderStatus::Pending | OrderStatus::Submitted | OrderStatus::PartiallyFilled => {
                // Cancel with broker (placeholder)
                self.cancel_with_broker(&order).await?;

                order.status = OrderStatus::Cancelled;
                self.update_order_status(&order).await?;

                let event = PlatformEvent::OrderCancelled { order_id };
                if let Err(e) = self.event_bus.publish(event).await {
                    warn!("Failed to publish order cancelled event: {}", e);
                }

                info!("Order {} cancelled successfully", order_id);
            }
            _ => {
                return Err(AppError::execution(format!(
                    "Order {} cannot be cancelled in status {:?}",
                    order_id, order.status
                )));
            }
        }

        Ok(())
    }

    /// Get order status
    pub async fn get_order_status(&self, order_id: Uuid) -> AppResult<OrderStatus> {
        let order = self.get_order_by_id(order_id).await?;
        Ok(order.status)
    }

    pub async fn create_order_direct(&self, order: Order) -> AppResult<Order> {
        if order.symbol.is_empty() {
            return Err(AppError::validation("Order symbol cannot be empty"));
        }

        if order.quantity <= 0 {
            return Err(AppError::validation("Order quantity must be positive"));
        }

        match order.order_type {
            crate::types::OrderType::Market => {}
            crate::types::OrderType::Limit
            | crate::types::OrderType::Stop
            | crate::types::OrderType::StopLimit => {
                if order.price.is_none() {
                    return Err(AppError::validation(
                        "Limit/Stop orders require a non-empty price",
                    ));
                }
            }
        }

        self.store_order(&order).await?;

        let event = PlatformEvent::OrderCreated {
            order: order.clone(),
        };

        if let Err(e) = self.event_bus.publish(event).await {
            warn!("Failed to publish order created event: {}", e);
        }

        Ok(order)
    }

    pub async fn list_orders(&self, limit: i64, offset: i64) -> AppResult<Vec<Order>> {
        let query = r#"
            SELECT order_id, symbol, side, quantity, price, order_type, status, strategy_id, created_at, updated_at, filled_quantity, average_fill_price
            FROM orders
            ORDER BY created_at DESC
            LIMIT $1
            OFFSET $2
        "#;

        let rows = sqlx::query_as::<_, OrderRow>(query)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(rows.into_iter().map(Order::from).collect())
    }

    pub async fn get_order(&self, order_id: Uuid) -> AppResult<Order> {
        self.get_order_by_id(order_id).await
    }

    /// Store order in database
    async fn store_order(&self, order: &Order) -> AppResult<()> {
        let query = r#"
            INSERT INTO orders (order_id, symbol, side, quantity, price, order_type, status, strategy_id, created_at, updated_at, filled_quantity, average_fill_price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#;

        let side_str = match order.side {
            crate::types::OrderSide::Buy => "BUY",
            crate::types::OrderSide::Sell => "SELL",
        };

        let order_type_str = match order.order_type {
            crate::types::OrderType::Market => "MARKET",
            crate::types::OrderType::Limit => "LIMIT",
            crate::types::OrderType::Stop => "STOP",
            crate::types::OrderType::StopLimit => "STOP_LIMIT",
        };

        let status_str = match order.status {
            OrderStatus::Pending => "PENDING",
            OrderStatus::Submitted => "SUBMITTED",
            OrderStatus::PartiallyFilled => "PARTIALLY_FILLED",
            OrderStatus::Filled => "FILLED",
            OrderStatus::Cancelled => "CANCELLED",
            OrderStatus::Rejected => "REJECTED",
        };

        sqlx::query(query)
            .bind(order.id)
            .bind(&order.symbol)
            .bind(side_str)
            .bind(order.quantity)
            .bind(order.price)
            .bind(order_type_str)
            .bind(status_str)
            .bind(&order.strategy_id)
            .bind(order.created_at)
            .bind(order.updated_at)
            .bind(order.filled_quantity)
            .bind(order.average_fill_price)
            .execute(&self.db_pool)
            .await
            .map_err(|e| AppError::Database(e))?;

        Ok(())
    }

    /// Get order from database
    async fn get_order_by_id(&self, order_id: Uuid) -> AppResult<Order> {
        let query = r#"
            SELECT order_id, symbol, side, quantity, price, order_type, status, strategy_id, created_at, updated_at, filled_quantity, average_fill_price
            FROM orders
            WHERE order_id = $1
        "#;

        let row = sqlx::query_as::<_, OrderRow>(query)
            .bind(order_id)
            .fetch_one(&self.db_pool)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => AppError::not_found(format!("Order {}", order_id)),
                _ => AppError::Database(e),
            })?;

        Ok(row.into())
    }

    /// Update order status in database
    async fn update_order_status(&self, order: &Order) -> AppResult<()> {
        let query = r#"
            UPDATE orders 
            SET status = $1, updated_at = $2, filled_quantity = $3, average_fill_price = $4
            WHERE order_id = $5
        "#;

        let status_str = match order.status {
            OrderStatus::Pending => "PENDING",
            OrderStatus::Submitted => "SUBMITTED",
            OrderStatus::PartiallyFilled => "PARTIALLY_FILLED",
            OrderStatus::Filled => "FILLED",
            OrderStatus::Cancelled => "CANCELLED",
            OrderStatus::Rejected => "REJECTED",
        };

        sqlx::query(query)
            .bind(status_str)
            .bind(order.updated_at)
            .bind(order.filled_quantity)
            .bind(order.average_fill_price)
            .bind(order.id)
            .execute(&self.db_pool)
            .await
            .map_err(|e| AppError::Database(e))?;

        Ok(())
    }

    /// Submit order to broker (placeholder implementation)
    async fn submit_to_broker(&self, _order: &Order) -> AppResult<()> {
        // This is a placeholder implementation
        // In a real system, this would integrate with actual broker APIs

        // Simulate network delay
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Simulate success (in real implementation, this could fail)
        Ok(())
    }

    /// Cancel order with broker (placeholder implementation)
    async fn cancel_with_broker(&self, _order: &Order) -> AppResult<()> {
        // This is a placeholder implementation
        // In a real system, this would integrate with actual broker APIs

        // Simulate network delay
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        // Simulate success
        Ok(())
    }
}

/// Database row structure for orders
#[derive(sqlx::FromRow)]
struct OrderRow {
    order_id: Uuid,
    symbol: String,
    side: String,
    quantity: i64,
    price: Option<rust_decimal::Decimal>,
    order_type: String,
    status: String,
    strategy_id: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    filled_quantity: i64,
    average_fill_price: Option<rust_decimal::Decimal>,
}

impl From<OrderRow> for Order {
    fn from(row: OrderRow) -> Self {
        let side = match row.side.as_str() {
            "BUY" => crate::types::OrderSide::Buy,
            "SELL" => crate::types::OrderSide::Sell,
            _ => crate::types::OrderSide::Buy, // Default fallback
        };

        let order_type = match row.order_type.as_str() {
            "MARKET" => crate::types::OrderType::Market,
            "LIMIT" => crate::types::OrderType::Limit,
            "STOP" => crate::types::OrderType::Stop,
            "STOP_LIMIT" => crate::types::OrderType::StopLimit,
            _ => crate::types::OrderType::Market, // Default fallback
        };

        let status = match row.status.as_str() {
            "PENDING" => OrderStatus::Pending,
            "SUBMITTED" => OrderStatus::Submitted,
            "PARTIALLY_FILLED" => OrderStatus::PartiallyFilled,
            "FILLED" => OrderStatus::Filled,
            "CANCELLED" => OrderStatus::Cancelled,
            "REJECTED" => OrderStatus::Rejected,
            _ => OrderStatus::Pending, // Default fallback
        };

        Order {
            id: row.order_id,
            symbol: row.symbol,
            side,
            quantity: row.quantity,
            price: row.price,
            order_type,
            status,
            strategy_id: row.strategy_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            filled_quantity: row.filled_quantity,
            average_fill_price: row.average_fill_price,
        }
    }
}
