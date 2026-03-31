use crate::error::{AppError, AppResult};
use crate::events::{EventBus, PlatformEvent};
use crate::types::{Order, OrderSide, OrderStatus, OrderType, Signal};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
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
        self.store_audit_log(
            "order_created",
            "order",
            &order.id.to_string(),
            json!({
                "symbol": order.symbol,
                "side": format!("{:?}", order.side),
                "quantity": order.quantity,
                "order_type": format!("{:?}", order.order_type),
                "status": format!("{:?}", order.status),
                "strategy_id": order.strategy_id,
            }),
        )
        .await?;

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
    pub async fn submit_order(&self, order_id: Uuid) -> AppResult<Order> {
        info!("Submitting order {}", order_id);

        // Get order from database
        let mut order = self.get_order_by_id(order_id).await?;

        // Check if order can be submitted
        self.ensure_transition_allowed(&order, OrderStatus::Submitted)?;

        // Submit to broker (placeholder implementation)
        match self.submit_to_broker(&order).await {
            Ok(_) => {
                let previous_status = order.status;
                self.transition_order(&mut order, OrderStatus::Submitted)?;
                self.update_order_status(&order).await?;
                self.store_audit_log(
                    "order_submitted",
                    "order",
                    &order.id.to_string(),
                    json!({
                        "previous_status": format!("{:?}", previous_status),
                        "status": format!("{:?}", order.status),
                    }),
                )
                .await?;

                info!("Order {} submitted successfully", order_id);
            }
            Err(e) => {
                self.transition_order(&mut order, OrderStatus::Rejected)?;
                self.update_order_status(&order).await?;
                self.store_audit_log(
                    "order_rejected",
                    "order",
                    &order.id.to_string(),
                    json!({
                        "status": format!("{:?}", order.status),
                        "reason": e.to_string(),
                    }),
                )
                .await?;

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

        Ok(order)
    }

    pub async fn submit_paper_order(&self, order_id: Uuid) -> AppResult<Order> {
        let submitted = self.submit_order(order_id).await?;
        match self.resolve_latest_market_snapshot(&submitted).await {
            Ok(snapshot) => match self.evaluate_paper_fill(&submitted, &snapshot).await {
                Ok(Some(decision)) => {
                    self.fill_order(submitted.id, decision.fill_quantity, decision.fill_price)
                        .await
                }
                Ok(None) => Ok(submitted),
                Err(error) => {
                    warn!(
                        "Paper order {} submitted without fill because it could not be evaluated: {}",
                        submitted.id, error
                    );
                    Ok(submitted)
                }
            },
            Err(error) => {
                warn!(
                    "Paper order {} submitted without fill because no market data was available: {}",
                    submitted.id, error
                );
                Ok(submitted)
            }
        }
    }

    /// Cancel an order
    pub async fn cancel_order(&self, order_id: Uuid) -> AppResult<()> {
        info!("Cancelling order {}", order_id);

        let mut order = self.get_order_by_id(order_id).await?;

        self.ensure_transition_allowed(&order, OrderStatus::Cancelled)?;

        // Cancel with broker (placeholder)
        self.cancel_with_broker(&order).await?;

        self.transition_order(&mut order, OrderStatus::Cancelled)?;
        self.update_order_status(&order).await?;
        self.store_audit_log(
            "order_cancelled",
            "order",
            &order.id.to_string(),
            json!({
                "status": format!("{:?}", order.status),
            }),
        )
        .await?;

        let event = PlatformEvent::OrderCancelled { order_id };
        if let Err(e) = self.event_bus.publish(event).await {
            warn!("Failed to publish order cancelled event: {}", e);
        }

        info!("Order {} cancelled successfully", order_id);

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
            OrderType::Market => {}
            OrderType::Limit => {
                if order.price.is_none() {
                    return Err(AppError::validation(
                        "Limit orders require a non-empty price",
                    ));
                }
            }
            OrderType::Stop => {
                if order.stop_price.is_none() {
                    return Err(AppError::validation(
                        "Stop orders require a non-empty stop price",
                    ));
                }
            }
            OrderType::StopLimit => {
                if order.price.is_none() || order.stop_price.is_none() {
                    return Err(AppError::validation(
                        "Stop-limit orders require both limit price and stop price",
                    ));
                }
            }
        }

        self.store_order(&order).await?;
        self.store_audit_log(
            "order_created",
            "order",
            &order.id.to_string(),
            json!({
                "symbol": order.symbol,
                "side": format!("{:?}", order.side),
                "quantity": order.quantity,
                "order_type": format!("{:?}", order.order_type),
                "status": format!("{:?}", order.status),
                "strategy_id": order.strategy_id,
            }),
        )
        .await?;

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
            SELECT order_id, symbol, side, quantity, price, stop_price, order_type, time_in_force, extended_hours, status, strategy_id, created_at, updated_at, filled_quantity, average_fill_price
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

    pub async fn run_paper_matching(&self, max_orders: i64) -> AppResult<PaperSimulationSummary> {
        let mut results = Vec::new();
        let open_orders = self.list_open_orders(max_orders).await?;

        for order in open_orders {
            let result = self.simulate_order_match(order).await?;
            results.push(result);
        }

        let filled = results
            .iter()
            .filter(|result| result.action == "filled")
            .count() as i64;
        let partially_filled = results
            .iter()
            .filter(|result| result.action == "partially_filled")
            .count() as i64;
        let submitted = results
            .iter()
            .filter(|result| result.action == "submitted")
            .count() as i64;
        let untouched = results
            .iter()
            .filter(|result| result.action == "unchanged")
            .count() as i64;
        let unsupported = results
            .iter()
            .filter(|result| result.action == "unsupported")
            .count() as i64;

        Ok(PaperSimulationSummary {
            processed: results.len() as i64,
            filled,
            partially_filled,
            submitted,
            untouched,
            unsupported,
            results,
        })
    }

    pub async fn fill_order(
        &self,
        order_id: Uuid,
        filled_quantity: i64,
        fill_price: Decimal,
    ) -> AppResult<Order> {
        if filled_quantity <= 0 {
            return Err(AppError::validation("Filled quantity must be positive"));
        }

        let mut order = self.get_order_by_id(order_id).await?;

        if !matches!(
            order.status,
            OrderStatus::Submitted | OrderStatus::PartiallyFilled
        ) {
            return Err(AppError::execution(format!(
                "Order {} cannot be filled from status {:?}",
                order_id, order.status
            )));
        }

        let new_filled_quantity = order.filled_quantity + filled_quantity;
        if new_filled_quantity > order.quantity {
            return Err(AppError::execution(format!(
                "Filled quantity {} exceeds order quantity {}",
                new_filled_quantity, order.quantity
            )));
        }

        let total_fill_value = order.average_fill_price.unwrap_or(Decimal::ZERO)
            * Decimal::from(order.filled_quantity)
            + (fill_price * Decimal::from(filled_quantity));

        order.filled_quantity = new_filled_quantity;
        order.average_fill_price = Some(total_fill_value / Decimal::from(new_filled_quantity));

        let next_status = if new_filled_quantity == order.quantity {
            OrderStatus::Filled
        } else {
            OrderStatus::PartiallyFilled
        };

        self.transition_order(&mut order, next_status)?;
        self.update_order_status(&order).await?;
        self.store_audit_log(
            if next_status == OrderStatus::Filled {
                "order_filled"
            } else {
                "order_partially_filled"
            },
            "order",
            &order.id.to_string(),
            json!({
                "filled_quantity": filled_quantity,
                "remaining_quantity": order.quantity - order.filled_quantity,
                "fill_price": fill_price,
                "average_fill_price": order.average_fill_price,
                "status": format!("{:?}", order.status),
            }),
        )
        .await?;

        let event = PlatformEvent::OrderFilled {
            order_id,
            filled_quantity,
            fill_price,
        };
        if let Err(error) = self.event_bus.publish(event).await {
            warn!("Failed to publish order filled event: {}", error);
        }

        Ok(order)
    }

    /// Store order in database
    async fn store_order(&self, order: &Order) -> AppResult<()> {
        let query = r#"
            INSERT INTO orders (order_id, symbol, side, quantity, price, stop_price, order_type, time_in_force, extended_hours, status, strategy_id, created_at, updated_at, filled_quantity, average_fill_price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
            .bind(order.stop_price)
            .bind(order_type_str)
            .bind(&order.time_in_force)
            .bind(order.extended_hours)
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
            SELECT order_id, symbol, side, quantity, price, stop_price, order_type, time_in_force, extended_hours, status, strategy_id, created_at, updated_at, filled_quantity, average_fill_price
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

    async fn list_open_orders(&self, limit: i64) -> AppResult<Vec<Order>> {
        let query = r#"
            SELECT order_id, symbol, side, quantity, price, stop_price, order_type, time_in_force, extended_hours, status, strategy_id, created_at, updated_at, filled_quantity, average_fill_price
            FROM orders
            WHERE status IN ('PENDING', 'SUBMITTED', 'PARTIALLY_FILLED')
            ORDER BY created_at ASC
            LIMIT $1
        "#;

        let rows = sqlx::query_as::<_, OrderRow>(query)
            .bind(limit)
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(rows.into_iter().map(Order::from).collect())
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

    async fn store_audit_log(
        &self,
        action: &str,
        resource_type: &str,
        resource_id: &str,
        details: serde_json::Value,
    ) -> AppResult<()> {
        let query = r#"
            INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
        "#;

        sqlx::query(query)
            .bind(None::<String>)
            .bind(action)
            .bind(resource_type)
            .bind(resource_id)
            .bind(details)
            .bind(Utc::now())
            .execute(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(())
    }

    pub async fn list_order_audit(
        &self,
        order_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> AppResult<Vec<AuditLogEntry>> {
        let query = r#"
            SELECT id, user_id, action, resource_type, resource_id, details, created_at
            FROM audit_log
            WHERE resource_type = 'order' AND resource_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            OFFSET $3
        "#;

        let rows = sqlx::query_as::<_, AuditLogEntry>(query)
            .bind(order_id.to_string())
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(rows)
    }

    fn ensure_transition_allowed(&self, order: &Order, next: OrderStatus) -> AppResult<()> {
        if !order.status.can_transition_to(next) {
            return Err(AppError::execution(format!(
                "Order {} cannot transition from {:?} to {:?}",
                order.id, order.status, next
            )));
        }

        Ok(())
    }

    fn transition_order(&self, order: &mut Order, next: OrderStatus) -> AppResult<()> {
        order.transition_to(next).map_err(AppError::execution)
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

    async fn resolve_latest_market_snapshot(&self, order: &Order) -> AppResult<MarketSnapshot> {
        let query = r#"
            SELECT price, bid_size, ask_size, volume
            FROM market_data
            WHERE symbol = $1
            ORDER BY timestamp DESC
            LIMIT 1
        "#;

        sqlx::query_as::<_, MarketSnapshotRow>(query)
            .bind(&order.symbol)
            .fetch_one(&self.db_pool)
            .await
            .map_err(|error| match error {
                sqlx::Error::RowNotFound => AppError::market_data(format!(
                    "No latest market data available for {}",
                    order.symbol
                )),
                _ => AppError::Database(error),
            })
            .map(MarketSnapshot::from)
    }

    async fn evaluate_paper_fill(
        &self,
        order: &Order,
        market_snapshot: &MarketSnapshot,
    ) -> AppResult<Option<PaperFillDecision>> {
        let market_price = market_snapshot.price;
        let remaining_quantity = order.quantity - order.filled_quantity;
        if remaining_quantity <= 0 {
            return Ok(None);
        }

        let available_quantity = market_snapshot
            .available_quantity(order.side)
            .unwrap_or(remaining_quantity)
            .min(remaining_quantity);

        let fill_quantity = available_quantity.max(0);
        if fill_quantity <= 0 {
            return Ok(None);
        }

        match order.order_type {
            OrderType::Market => Ok(Some(PaperFillDecision {
                fill_price: market_price,
                fill_quantity,
            })),
            OrderType::Limit => match order.price {
                Some(limit_price)
                    if should_fill_limit_order(order.side, market_price, limit_price) =>
                {
                    Ok(Some(PaperFillDecision {
                        fill_price: limit_price,
                        fill_quantity,
                    }))
                }
                Some(_) | None => Ok(None),
            },
            OrderType::Stop => match order.stop_price {
                Some(stop_price)
                    if should_trigger_stop_order(order.side, market_price, stop_price) =>
                {
                    Ok(Some(PaperFillDecision {
                        fill_price: market_price,
                        fill_quantity,
                    }))
                }
                Some(_) | None => Ok(None),
            },
            OrderType::StopLimit => match (order.stop_price, order.price) {
                (Some(stop_price), Some(limit_price))
                    if should_trigger_stop_order(order.side, market_price, stop_price)
                        && should_fill_limit_order(order.side, market_price, limit_price) =>
                {
                    Ok(Some(PaperFillDecision {
                        fill_price: limit_price,
                        fill_quantity,
                    }))
                }
                (Some(_), Some(_)) => Ok(None),
                _ => Ok(None),
            },
        }
    }

    async fn simulate_order_match(&self, order: Order) -> AppResult<PaperSimulationResult> {
        let status_before = format!("{:?}", order.status);
        let mut working_order = order.clone();
        let mut action = if working_order.status == OrderStatus::Pending {
            "submitted".to_string()
        } else {
            "unchanged".to_string()
        };
        let mut market_price = None;
        let mut fill_price = None;

        if working_order.status == OrderStatus::Pending {
            working_order = self.submit_order(working_order.id).await?;
        }

        let detail = match self.resolve_latest_market_snapshot(&working_order).await {
            Ok(snapshot) => {
                market_price = Some(snapshot.price);
                match self.evaluate_paper_fill(&working_order, &snapshot).await {
                    Ok(Some(decision)) => {
                        fill_price = Some(decision.fill_price);
                        let remaining_quantity =
                            working_order.quantity - working_order.filled_quantity;
                        let fill_quantity = decision.fill_quantity.min(remaining_quantity);
                        let fill_kind = if fill_quantity < remaining_quantity {
                            action = "partially_filled".to_string();
                            "partially filled"
                        } else {
                            action = "filled".to_string();
                            "filled"
                        };
                        working_order = self
                            .fill_order(working_order.id, fill_quantity, decision.fill_price)
                            .await?;
                        match working_order.order_type {
                            OrderType::Market => format!(
                                "Market order {} at latest market price {} for {} shares",
                                fill_kind, snapshot.price, fill_quantity
                            ),
                            OrderType::Limit => format!(
                                "Limit order {} at {} for {} shares because market price {} crossed limit {}",
                                fill_kind,
                                decision.fill_price,
                                fill_quantity,
                                snapshot.price,
                                working_order.price.unwrap_or(decision.fill_price)
                            ),
                            OrderType::Stop => format!(
                                "Stop order triggered and {} at market price {} for {} shares",
                                fill_kind,
                                snapshot.price,
                                fill_quantity
                            ),
                            OrderType::StopLimit => format!(
                                "Stop-limit order triggered and {} at limit {} for {} shares",
                                fill_kind,
                                decision.fill_price,
                                fill_quantity
                            ),
                        }
                    }
                    Ok(None) => match working_order.order_type {
                        OrderType::Market => {
                            format!(
                                "Market order submitted but no liquidity was available at latest market price {}",
                                snapshot.price
                            )
                        }
                        OrderType::Limit => match working_order.price {
                            Some(limit_price) => {
                                if action == "submitted" {
                                    format!(
                                        "Pending limit order submitted and remains open: market price {} has not reached limit {}",
                                        snapshot.price, limit_price
                                    )
                                } else {
                                    format!(
                                        "Limit order remains open: market price {} has not reached limit {}",
                                        snapshot.price, limit_price
                                    )
                                }
                            }
                            None => {
                                action = "unsupported".to_string();
                                "Limit order missing limit price".to_string()
                            }
                        },
                        OrderType::Stop => match working_order.stop_price {
                            Some(stop_price) => {
                                if action == "submitted" {
                                    format!(
                                        "Pending stop order submitted and remains open: market price {} has not crossed stop {}",
                                        snapshot.price, stop_price
                                    )
                                } else {
                                    format!(
                                        "Stop condition not met: market price {} has not crossed stop {}",
                                        snapshot.price, stop_price
                                    )
                                }
                            }
                            None => {
                                action = "unsupported".to_string();
                                "Stop order missing stop price".to_string()
                            }
                        },
                        OrderType::StopLimit => {
                            match (working_order.stop_price, working_order.price) {
                                (Some(stop_price), Some(limit_price)) => {
                                    if action == "submitted" {
                                        format!(
                                        "Pending stop-limit order submitted and remains open: market price {} has not satisfied limit {} after stop {}",
                                        snapshot.price, limit_price, stop_price
                                    )
                                    } else {
                                        format!(
                                        "Stop-limit triggered, but market price {} has not satisfied limit {} after stop {}",
                                        snapshot.price, limit_price, stop_price
                                    )
                                    }
                                }
                                _ => {
                                    action = "unsupported".to_string();
                                    "Stop-limit order missing stop price or limit price".to_string()
                                }
                            }
                        }
                    },
                    Err(error) => {
                        action = "unsupported".to_string();
                        format!("Paper matching failed to evaluate order: {}", error)
                    }
                }
            }
            Err(error) => {
                action = "unsupported".to_string();
                format!("No latest market data available: {}", error)
            }
        };

        Ok(PaperSimulationResult {
            order_id: working_order.id,
            symbol: working_order.symbol,
            status_before,
            status_after: format!("{:?}", working_order.status),
            action,
            detail,
            market_price,
            fill_price,
        })
    }
}

fn should_fill_limit_order(side: OrderSide, market_price: Decimal, limit_price: Decimal) -> bool {
    match side {
        OrderSide::Buy => market_price <= limit_price,
        OrderSide::Sell => market_price >= limit_price,
    }
}

fn should_trigger_stop_order(side: OrderSide, market_price: Decimal, stop_price: Decimal) -> bool {
    match side {
        OrderSide::Buy => market_price >= stop_price,
        OrderSide::Sell => market_price <= stop_price,
    }
}

#[derive(Debug, Clone)]
pub struct PaperSimulationResult {
    pub order_id: Uuid,
    pub symbol: String,
    pub status_before: String,
    pub status_after: String,
    pub action: String,
    pub detail: String,
    pub market_price: Option<Decimal>,
    pub fill_price: Option<Decimal>,
}

#[derive(Debug, Clone)]
pub struct PaperSimulationSummary {
    pub processed: i64,
    pub filled: i64,
    pub partially_filled: i64,
    pub submitted: i64,
    pub untouched: i64,
    pub unsupported: i64,
    pub results: Vec<PaperSimulationResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AuditLogEntry {
    pub id: i64,
    pub user_id: Option<String>,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub details: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy)]
struct PaperFillDecision {
    fill_price: Decimal,
    fill_quantity: i64,
}

#[derive(Debug, Clone, Copy, sqlx::FromRow)]
struct MarketSnapshotRow {
    price: rust_decimal::Decimal,
    bid_size: Option<i64>,
    ask_size: Option<i64>,
    volume: i64,
}

#[derive(Debug, Clone, Copy)]
struct MarketSnapshot {
    price: Decimal,
    bid_size: Option<i64>,
    ask_size: Option<i64>,
    volume: i64,
}

impl From<MarketSnapshotRow> for MarketSnapshot {
    fn from(row: MarketSnapshotRow) -> Self {
        Self {
            price: row.price,
            bid_size: row.bid_size,
            ask_size: row.ask_size,
            volume: row.volume,
        }
    }
}

impl MarketSnapshot {
    fn available_quantity(&self, side: OrderSide) -> Option<i64> {
        let quote_size = match side {
            OrderSide::Buy => self.ask_size,
            OrderSide::Sell => self.bid_size,
        };

        quote_size.or_else(|| {
            if self.volume > 0 {
                Some(self.volume.min(i64::MAX / 4))
            } else {
                None
            }
        })
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
    stop_price: Option<rust_decimal::Decimal>,
    order_type: String,
    time_in_force: Option<String>,
    extended_hours: bool,
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
            stop_price: row.stop_price,
            order_type,
            time_in_force: row.time_in_force,
            extended_hours: row.extended_hours,
            status,
            strategy_id: row.strategy_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            filled_quantity: row.filled_quantity,
            average_fill_price: row.average_fill_price,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn order_status_state_machine_allows_expected_transitions() {
        assert!(OrderStatus::Pending.can_transition_to(OrderStatus::Submitted));
        assert!(OrderStatus::Submitted.can_transition_to(OrderStatus::PartiallyFilled));
        assert!(OrderStatus::PartiallyFilled.can_transition_to(OrderStatus::Filled));
        assert!(OrderStatus::Submitted.can_transition_to(OrderStatus::Cancelled));
    }

    #[test]
    fn order_status_state_machine_blocks_terminal_reactivation() {
        assert!(!OrderStatus::Rejected.can_transition_to(OrderStatus::Submitted));
        assert!(!OrderStatus::Cancelled.can_transition_to(OrderStatus::Submitted));
        assert!(!OrderStatus::Filled.can_transition_to(OrderStatus::Cancelled));
    }

    #[test]
    fn limit_order_matching_obeys_side_specific_price_rules() {
        let market_price = Decimal::from_str("99.50").unwrap();
        let buy_limit = Decimal::from_str("100.00").unwrap();
        let sell_limit = Decimal::from_str("100.00").unwrap();

        assert!(should_fill_limit_order(
            OrderSide::Buy,
            market_price,
            buy_limit
        ));
        assert!(!should_fill_limit_order(
            OrderSide::Sell,
            market_price,
            sell_limit
        ));
    }

    #[test]
    fn stop_order_triggering_obeys_side_specific_price_rules() {
        let market_price = Decimal::from_str("101.00").unwrap();
        let buy_stop = Decimal::from_str("100.00").unwrap();
        let sell_stop = Decimal::from_str("100.00").unwrap();

        assert!(should_trigger_stop_order(
            OrderSide::Buy,
            market_price,
            buy_stop
        ));
        assert!(!should_trigger_stop_order(
            OrderSide::Sell,
            market_price,
            sell_stop
        ));
    }

    #[test]
    fn market_snapshot_prefers_side_specific_quote_size() {
        let snapshot = MarketSnapshot {
            price: Decimal::from_str("100.00").unwrap(),
            bid_size: Some(80),
            ask_size: Some(25),
            volume: 1000,
        };

        assert_eq!(snapshot.available_quantity(OrderSide::Buy), Some(25));
        assert_eq!(snapshot.available_quantity(OrderSide::Sell), Some(80));
    }

    #[test]
    fn market_snapshot_falls_back_to_volume_when_quote_sizes_are_missing() {
        let snapshot = MarketSnapshot {
            price: Decimal::from_str("100.00").unwrap(),
            bid_size: None,
            ask_size: None,
            volume: 120,
        };

        assert_eq!(snapshot.available_quantity(OrderSide::Buy), Some(120));
        assert_eq!(snapshot.available_quantity(OrderSide::Sell), Some(120));
    }
}
