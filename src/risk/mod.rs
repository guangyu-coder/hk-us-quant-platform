use crate::error::{AppError, AppResult};
use crate::events::{EventBus, PlatformEvent};
use crate::types::{Order, Portfolio, RiskMetrics};
use serde::{Deserialize, Serialize};
use serde_json::json;
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
                rule_code: "MAX_ORDER_SIZE".to_string(),
                check_type: "order_size".to_string(),
                passed: false,
                message: format!(
                    "Order size {} exceeds maximum {}",
                    order.quantity, self.max_order_size
                ),
                severity: RiskSeverity::High,
                actual_value: Some(order.quantity.to_string()),
                threshold_value: Some(self.max_order_size.to_string()),
            });
        } else {
            checks.push(RiskCheck {
                rule_code: "MAX_ORDER_SIZE".to_string(),
                check_type: "order_size".to_string(),
                passed: true,
                message: "Order size within limits".to_string(),
                severity: RiskSeverity::Low,
                actual_value: Some(order.quantity.to_string()),
                threshold_value: Some(self.max_order_size.to_string()),
            });
        }

        // Check symbol validity
        if self.is_valid_trading_symbol(&order.symbol).await? {
            checks.push(RiskCheck {
                rule_code: "TRADABLE_SYMBOL".to_string(),
                check_type: "symbol_validity".to_string(),
                passed: true,
                message: "Symbol is valid for trading".to_string(),
                severity: RiskSeverity::Low,
                actual_value: Some(order.symbol.clone()),
                threshold_value: Some("listed symbol".to_string()),
            });
        } else {
            checks.push(RiskCheck {
                rule_code: "TRADABLE_SYMBOL".to_string(),
                check_type: "symbol_validity".to_string(),
                passed: false,
                message: format!("Symbol {} is not valid for trading", order.symbol),
                severity: RiskSeverity::Critical,
                actual_value: Some(order.symbol.clone()),
                threshold_value: Some("listed symbol".to_string()),
            });
        }

        // Check market hours (placeholder)
        checks.push(RiskCheck {
            rule_code: "MARKET_HOURS".to_string(),
            check_type: "market_hours".to_string(),
            passed: true,
            message: "Market is open".to_string(),
            severity: RiskSeverity::Low,
            actual_value: Some("open".to_string()),
            threshold_value: Some("open session required".to_string()),
        });

        // Determine overall result
        let audit_checks = checks.clone();
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

        self.store_audit_log(
            "risk_check_completed",
            "order",
            &order.id.to_string(),
            json!({
                "status": result.summary().0,
                "message": result.summary().1,
                "checks": audit_checks,
            }),
        )
        .await?;

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

            self.store_audit_log(
                "risk_alert_triggered",
                "portfolio",
                &portfolio.id,
                json!({
                    "alert_type": "leverage_exceeded",
                    "message": format!(
                        "Portfolio leverage {} exceeds limit 3.0",
                        risk_metrics.leverage
                    ),
                    "severity": "HIGH",
                    "leverage": risk_metrics.leverage,
                }),
            )
            .await?;
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
        self.store_audit_log(
            "risk_alert_triggered",
            "risk",
            alert_type,
            json!({
                "alert_type": alert_type,
                "message": message,
                "severity": severity,
            }),
        )
        .await?;

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
            .bind(chrono::Utc::now())
            .execute(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(())
    }

    pub async fn get_risk_limits(&self) -> AppResult<RiskLimitsSnapshot> {
        let max_leverage = self
            .load_system_config_decimal("max_leverage")
            .await?
            .and_then(|value| value.as_f64())
            .unwrap_or(3.0);
        let risk_check_enabled = self
            .load_system_config_bool("risk_check_enabled")
            .await?
            .unwrap_or(true);
        let paper_trading = self
            .load_system_config_bool("paper_trading")
            .await?
            .unwrap_or(true);

        Ok(RiskLimitsSnapshot {
            max_order_size: self.max_order_size,
            max_leverage,
            max_daily_loss: None,
            max_portfolio_exposure: None,
            max_single_stock_weight: None,
            risk_check_enabled,
            paper_trading,
        })
    }

    async fn load_system_config_value(&self, key: &str) -> AppResult<Option<serde_json::Value>> {
        let query = r#"
            SELECT value
            FROM system_config
            WHERE key = $1
        "#;

        let value = sqlx::query_scalar::<_, serde_json::Value>(query)
            .bind(key)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(AppError::Database)?;

        Ok(value)
    }

    async fn load_system_config_bool(&self, key: &str) -> AppResult<Option<bool>> {
        Ok(self
            .load_system_config_value(key)
            .await?
            .and_then(|value| value.as_bool()))
    }

    async fn load_system_config_decimal(&self, key: &str) -> AppResult<Option<serde_json::Value>> {
        self.load_system_config_value(key).await
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskLimitsSnapshot {
    pub max_order_size: i64,
    pub max_leverage: f64,
    pub max_daily_loss: Option<rust_decimal::Decimal>,
    pub max_portfolio_exposure: Option<rust_decimal::Decimal>,
    pub max_single_stock_weight: Option<f64>,
    pub risk_check_enabled: bool,
    pub paper_trading: bool,
}

/// Risk check result
#[derive(Debug, Clone, Serialize, Deserialize)]
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

    pub fn summary(&self) -> (&'static str, Option<&str>) {
        match self {
            RiskCheckResult::Passed { .. } => ("passed", None),
            RiskCheckResult::Warning { message, .. } => ("warning", Some(message.as_str())),
            RiskCheckResult::Rejected { reason, .. } => ("rejected", Some(reason.as_str())),
        }
    }
}

/// Individual risk check
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskCheck {
    pub rule_code: String,
    pub check_type: String,
    pub passed: bool,
    pub message: String,
    pub severity: RiskSeverity,
    pub actual_value: Option<String>,
    pub threshold_value: Option<String>,
}

/// Risk severity levels
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn risk_check_summary_preserves_structured_fields() {
        let check = RiskCheck {
            rule_code: "MAX_ORDER_SIZE".to_string(),
            check_type: "order_size".to_string(),
            passed: false,
            message: "Order size 200 exceeds maximum 100".to_string(),
            severity: RiskSeverity::High,
            actual_value: Some("200".to_string()),
            threshold_value: Some("100".to_string()),
        };

        let result = RiskCheckResult::Warning {
            message: "Some risk checks failed but order can proceed".to_string(),
            checks: vec![check.clone()],
        };

        let (status, message) = result.summary();
        assert_eq!(status, "warning");
        assert_eq!(
            message,
            Some("Some risk checks failed but order can proceed")
        );
        assert_eq!(check.rule_code, "MAX_ORDER_SIZE");
        assert_eq!(check.actual_value.as_deref(), Some("200"));
        assert_eq!(check.threshold_value.as_deref(), Some("100"));
    }
}
