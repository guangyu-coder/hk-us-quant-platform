use crate::error::{AppError, AppResult};
use crate::events::{EventBus, PlatformEvent};
use crate::types::{Order, Portfolio, RiskMetrics};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Risk service for managing trading risk
pub struct RiskService {
    db_pool: PgPool,
    event_bus: Arc<EventBus>,
    max_order_size: i64,
}

impl RiskService {
    /// Create a new risk service
    pub async fn new(
        db_pool: PgPool,
        event_bus: Arc<EventBus>,
        max_order_size: i64,
    ) -> AppResult<Self> {
        Ok(Self {
            db_pool,
            event_bus,
            max_order_size,
        })
    }

    /// Check pre-trade risk for an order
    pub async fn check_pre_trade_risk(&self, order: &Order) -> AppResult<RiskCheckResult> {
        info!("Performing pre-trade risk check for order {}", order.id);

        let mut checks = Vec::new();

        // Check order size limits
        if order.quantity > self.max_order_size {
            checks.push(RiskCheck {
                check_type: "order_size".to_string(),
                passed: false,
                message: format!(
                    "Order size {} exceeds maximum {}",
                    order.quantity, self.max_order_size
                ),
                severity: RiskSeverity::High,
            });
        } else {
            checks.push(RiskCheck {
                check_type: "order_size".to_string(),
                passed: true,
                message: "Order size within limits".to_string(),
                severity: RiskSeverity::Low,
            });
        }

        // Check symbol validity
        if self.is_valid_trading_symbol(&order.symbol).await? {
            checks.push(RiskCheck {
                check_type: "symbol_validity".to_string(),
                passed: true,
                message: "Symbol is valid for trading".to_string(),
                severity: RiskSeverity::Low,
            });
        } else {
            checks.push(RiskCheck {
                check_type: "symbol_validity".to_string(),
                passed: false,
                message: format!("Symbol {} is not valid for trading", order.symbol),
                severity: RiskSeverity::Critical,
            });
        }

        // Check market hours (placeholder)
        checks.push(RiskCheck {
            check_type: "market_hours".to_string(),
            passed: true,
            message: "Market is open".to_string(),
            severity: RiskSeverity::Low,
        });

        // Determine overall result
        let failed_checks: Vec<&RiskCheck> = checks.iter().filter(|c| !c.passed).collect();
        let has_critical_failures = failed_checks
            .iter()
            .any(|c| c.severity == RiskSeverity::Critical);

        let result = if has_critical_failures {
            RiskCheckResult::Rejected {
                reason: "Critical risk checks failed".to_string(),
                checks,
            }
        } else if !failed_checks.is_empty() {
            RiskCheckResult::Warning {
                message: "Some risk checks failed but order can proceed".to_string(),
                checks,
            }
        } else {
            RiskCheckResult::Passed { checks }
        };

        // Publish risk check event
        let event = match &result {
            RiskCheckResult::Passed { .. } | RiskCheckResult::Warning { .. } => {
                PlatformEvent::RiskCheckPassed { order_id: order.id }
            }
            RiskCheckResult::Rejected { reason, .. } => PlatformEvent::RiskCheckFailed {
                order_id: order.id,
                reason: reason.clone(),
            },
        };

        if let Err(e) = self.event_bus.publish(event).await {
            warn!("Failed to publish risk check event: {}", e);
        }

        debug!("Risk check completed for order {}: {:?}", order.id, result);
        Ok(result)
    }

    /// Monitor portfolio risk
    pub async fn monitor_portfolio_risk(&self, portfolio: &Portfolio) -> AppResult<RiskMetrics> {
        debug!("Monitoring portfolio risk for {}", portfolio.id);

        let total_exposure = portfolio
            .positions
            .values()
            .map(|pos| pos.market_value.abs())
            .sum();

        let mut risk_metrics = RiskMetrics::new(portfolio.total_value, total_exposure);

        // Calculate additional risk metrics (placeholder implementations)
        risk_metrics.var_1d = Some(portfolio.total_value * rust_decimal::Decimal::new(5, 2)); // 5% VaR
        risk_metrics.max_drawdown = Some(0.15); // 15% max drawdown
        risk_metrics.sharpe_ratio = Some(1.2); // Sharpe ratio

        // Check for risk limit violations
        if risk_metrics.leverage > 3.0 {
            let event = PlatformEvent::RiskAlertTriggered {
                alert_type: "leverage_exceeded".to_string(),
                message: format!(
                    "Portfolio leverage {} exceeds limit 3.0",
                    risk_metrics.leverage
                ),
                severity: "HIGH".to_string(),
            };

            if let Err(e) = self.event_bus.publish(event).await {
                warn!("Failed to publish risk alert event: {}", e);
            }
        }

        Ok(risk_metrics)
    }

    /// Calculate Value at Risk (VaR)
    pub async fn calculate_var(
        &self,
        positions: &[crate::types::Position],
    ) -> AppResult<VaRResult> {
        debug!("Calculating VaR for {} positions", positions.len());

        // This is a simplified VaR calculation
        // In a real system, this would use historical data, Monte Carlo simulation, etc.

        let total_value: rust_decimal::Decimal =
            positions.iter().map(|pos| pos.market_value.abs()).sum();

        let var_1d = total_value * rust_decimal::Decimal::new(5, 2); // 5% of portfolio value
        let var_10d = total_value * rust_decimal::Decimal::new(15, 2); // 15% of portfolio value

        Ok(VaRResult {
            confidence_level: 0.95,
            var_1d,
            var_10d,
            calculated_at: chrono::Utc::now(),
        })
    }

    /// Trigger risk alert
    pub async fn trigger_risk_alert(
        &self,
        alert_type: &str,
        message: &str,
        severity: &str,
    ) -> AppResult<()> {
        info!("Triggering risk alert: {} - {}", alert_type, message);

        let event = PlatformEvent::RiskAlertTriggered {
            alert_type: alert_type.to_string(),
            message: message.to_string(),
            severity: severity.to_string(),
        };

        self.event_bus.publish(event).await?;

        // Store alert in database for audit trail
        self.store_risk_alert(alert_type, message, severity).await?;

        Ok(())
    }

    /// Check if symbol is valid for trading
    async fn is_valid_trading_symbol(&self, symbol: &str) -> AppResult<bool> {
        // This is a placeholder implementation
        // In a real system, this would check against:
        // - Exchange listings
        // - Trading permissions
        // - Regulatory restrictions

        let valid_symbols = vec![
            "AAPL", "GOOGL", "MSFT", "TSLA", "AMZN", "0700.HK", "0941.HK", "1299.HK", "2318.HK",
        ];

        Ok(valid_symbols.contains(&symbol))
    }

    /// Store risk alert in database
    async fn store_risk_alert(
        &self,
        alert_type: &str,
        message: &str,
        severity: &str,
    ) -> AppResult<()> {
        let query = r#"
            INSERT INTO risk_alerts (alert_type, message, severity, created_at)
            VALUES ($1, $2, $3, $4)
        "#;

        sqlx::query(query)
            .bind(alert_type)
            .bind(message)
            .bind(severity)
            .bind(chrono::Utc::now())
            .execute(&self.db_pool)
            .await
            .map_err(|e| AppError::Database(e))?;

        Ok(())
    }

    pub async fn list_alerts(&self, limit: i64, offset: i64) -> AppResult<Vec<RiskAlert>> {
        let query = r#"
            SELECT id, alert_type, message, severity, created_at
            FROM risk_alerts
            ORDER BY created_at DESC
            LIMIT $1
            OFFSET $2
        "#;

        let rows = sqlx::query_as::<_, RiskAlert>(query)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(rows)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RiskAlert {
    pub id: i64,
    pub alert_type: String,
    pub message: String,
    pub severity: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Risk check result
#[derive(Debug, Clone)]
pub enum RiskCheckResult {
    Passed {
        checks: Vec<RiskCheck>,
    },
    Warning {
        message: String,
        checks: Vec<RiskCheck>,
    },
    Rejected {
        reason: String,
        checks: Vec<RiskCheck>,
    },
}

impl RiskCheckResult {
    pub fn is_passed(&self) -> bool {
        matches!(
            self,
            RiskCheckResult::Passed { .. } | RiskCheckResult::Warning { .. }
        )
    }

    pub fn is_rejected(&self) -> bool {
        matches!(self, RiskCheckResult::Rejected { .. })
    }
}

/// Individual risk check
#[derive(Debug, Clone)]
pub struct RiskCheck {
    pub check_type: String,
    pub passed: bool,
    pub message: String,
    pub severity: RiskSeverity,
}

/// Risk severity levels
#[derive(Debug, Clone, PartialEq)]
pub enum RiskSeverity {
    Low,
    Medium,
    High,
    Critical,
}

/// Value at Risk calculation result
#[derive(Debug, Clone)]
pub struct VaRResult {
    pub confidence_level: f64,
    pub var_1d: rust_decimal::Decimal,
    pub var_10d: rust_decimal::Decimal,
    pub calculated_at: chrono::DateTime<chrono::Utc>,
}
