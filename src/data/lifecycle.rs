use crate::error::{AppError, AppResult};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::PgPool;
use tracing::info;

/// Data lifecycle manager for cleanup and archival operations
pub struct DataLifecycleManager {
    db_pool: PgPool,
    /// Retention period for market data (default: 90 days)
    market_data_retention_days: i64,
    /// Retention period for orders (default: 365 days)
    order_retention_days: i64,
    /// Retention period for positions (default: 365 days)
    position_retention_days: i64,
    /// Archive threshold for market data (default: 30 days)
    market_data_archive_days: i64,
    /// Archive threshold for orders (default: 90 days)
    order_archive_days: i64,
}

impl DataLifecycleManager {
    /// Create a new data lifecycle manager
    pub fn new(db_pool: PgPool) -> Self {
        Self {
            db_pool,
            market_data_retention_days: 90,
            order_retention_days: 365,
            position_retention_days: 365,
            market_data_archive_days: 30,
            order_archive_days: 90,
        }
    }

    /// Create a new data lifecycle manager with custom retention periods
    pub fn with_retention(
        db_pool: PgPool,
        market_data_retention_days: i64,
        order_retention_days: i64,
        position_retention_days: i64,
        market_data_archive_days: i64,
        order_archive_days: i64,
    ) -> Self {
        Self {
            db_pool,
            market_data_retention_days,
            order_retention_days,
            position_retention_days,
            market_data_archive_days,
            order_archive_days,
        }
    }

    /// Get current retention settings
    pub fn get_retention_settings(&self) -> RetentionSettings {
        RetentionSettings {
            market_data_retention_days: self.market_data_retention_days,
            order_retention_days: self.order_retention_days,
            position_retention_days: self.position_retention_days,
            market_data_archive_days: self.market_data_archive_days,
            order_archive_days: self.order_archive_days,
        }
    }

    /// Set market data retention period
    pub fn set_market_data_retention_days(&mut self, days: i64) {
        self.market_data_retention_days = days;
    }

    /// Set order retention period
    pub fn set_order_retention_days(&mut self, days: i64) {
        self.order_retention_days = days;
    }

    /// Set position retention period
    pub fn set_position_retention_days(&mut self, days: i64) {
        self.position_retention_days = days;
    }

    /// Set market data archive threshold
    pub fn set_market_data_archive_days(&mut self, days: i64) {
        self.market_data_archive_days = days;
    }

    /// Set order archive threshold
    pub fn set_order_archive_days(&mut self, days: i64) {
        self.order_archive_days = days;
    }

    /// Clean up expired market data
    pub async fn cleanup_expired_market_data(&self) -> AppResult<CleanupResult> {
        info!(
            "Cleaning up market data older than {} days",
            self.market_data_retention_days
        );

        let cutoff_date = Utc::now() - Duration::days(self.market_data_retention_days);

        let query = r#"
            DELETE FROM market_data
            WHERE timestamp < $1
        "#;

        let deleted_result = sqlx::query(query)
            .bind(cutoff_date)
            .execute(&self.db_pool)
            .await
            .map_err(|e| {
                AppError::database(format!("Failed to delete expired market data: {}", e))
            })?;

        let deleted_count = deleted_result.rows_affected() as i64;

        info!("Cleaned up {} expired market data records", deleted_count);

        Ok(CleanupResult {
            table: "market_data".to_string(),
            deleted_count,
            cutoff_date,
        })
    }

    /// Clean up expired orders
    pub async fn cleanup_expired_orders(&self) -> AppResult<CleanupResult> {
        info!(
            "Cleaning up orders older than {} days",
            self.order_retention_days
        );

        let cutoff_date = Utc::now() - Duration::days(self.order_retention_days);

        let query = r#"
            DELETE FROM orders
            WHERE created_at < $1
        "#;

        let deleted_result = sqlx::query(query)
            .bind(cutoff_date)
            .execute(&self.db_pool)
            .await
            .map_err(|e| AppError::database(format!("Failed to delete expired orders: {}", e)))?;

        let deleted_count = deleted_result.rows_affected() as i64;

        info!("Cleaned up {} expired order records", deleted_count);

        Ok(CleanupResult {
            table: "orders".to_string(),
            deleted_count,
            cutoff_date,
        })
    }

    /// Clean up expired positions (only for inactive positions)
    pub async fn cleanup_expired_positions(&self) -> AppResult<CleanupResult> {
        info!(
            "Cleaning up positions older than {} days",
            self.position_retention_days
        );

        let cutoff_date = Utc::now() - Duration::days(self.position_retention_days);

        // Only delete positions that haven't been updated recently
        // and have zero quantity (closed positions)
        let query = r#"
            DELETE FROM positions
            WHERE last_updated < $1 AND quantity = 0
        "#;

        let deleted_result = sqlx::query(query)
            .bind(cutoff_date)
            .execute(&self.db_pool)
            .await
            .map_err(|e| {
                AppError::database(format!("Failed to delete expired positions: {}", e))
            })?;

        let deleted_count = deleted_result.rows_affected() as i64;

        info!("Cleaned up {} expired position records", deleted_count);

        Ok(CleanupResult {
            table: "positions".to_string(),
            deleted_count,
            cutoff_date,
        })
    }

    /// Archive old market data to long-term storage
    pub async fn archive_old_market_data(&self) -> AppResult<ArchiveResult> {
        info!(
            "Archiving market data older than {} days",
            self.market_data_archive_days
        );

        let cutoff_date = Utc::now() - Duration::days(self.market_data_archive_days);

        // First, get the data to archive
        let select_query = r#"
            SELECT symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size
            FROM market_data
            WHERE timestamp < $1
            ORDER BY timestamp ASC
        "#;

        let rows_to_archive = sqlx::query_as::<_, MarketDataArchiveRow>(select_query)
            .bind(cutoff_date)
            .fetch_all(&self.db_pool)
            .await
            .map_err(|e| {
                AppError::database(format!("Failed to select market data for archival: {}", e))
            })?;

        if rows_to_archive.is_empty() {
            info!("No market data to archive");
            return Ok(ArchiveResult {
                table: "market_data".to_string(),
                archived_count: 0,
                cutoff_date,
                archived_details: Vec::new(),
            });
        }

        // Convert to archive format
        let archived_data: Vec<MarketDataArchive> = rows_to_archive
            .into_iter()
            .map(|row| MarketDataArchive {
                symbol: row.symbol,
                timestamp: row.timestamp,
                price: row.price,
                volume: row.volume,
                bid_price: row.bid_price,
                ask_price: row.ask_price,
                bid_size: row.bid_size,
                ask_size: row.ask_size,
                archived_at: Utc::now(),
            })
            .collect();

        // Insert into archive table
        let insert_query = r#"
            INSERT INTO market_data_archive (
                symbol, timestamp, price, volume, bid_price, ask_price, bid_size, ask_size, archived_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (symbol, timestamp) DO NOTHING
        "#;

        for archive_row in &archived_data {
            sqlx::query(insert_query)
                .bind(&archive_row.symbol)
                .bind(archive_row.timestamp)
                .bind(archive_row.price)
                .bind(archive_row.volume)
                .bind(archive_row.bid_price)
                .bind(archive_row.ask_price)
                .bind(archive_row.bid_size)
                .bind(archive_row.ask_size)
                .bind(archive_row.archived_at)
                .execute(&self.db_pool)
                .await
                .map_err(|e| {
                    AppError::database(format!("Failed to insert archive record: {}", e))
                })?;
        }

        // Delete archived data from main table
        let delete_query = r#"
            DELETE FROM market_data 
            WHERE timestamp < $1
        "#;

        sqlx::query(delete_query)
            .bind(cutoff_date)
            .execute(&self.db_pool)
            .await
            .map_err(|e| {
                AppError::database(format!("Failed to delete archived market data: {}", e))
            })?;

        let archived_count = archived_data.len() as i64;

        info!("Archived {} market data records", archived_count);

        Ok(ArchiveResult {
            table: "market_data".to_string(),
            archived_count,
            cutoff_date,
            archived_details: archived_data
                .into_iter()
                .map(ArchiveDetail::MarketData)
                .collect(),
        })
    }

    /// Archive old orders to long-term storage
    pub async fn archive_old_orders(&self) -> AppResult<ArchiveResult> {
        info!(
            "Archiving orders older than {} days",
            self.order_archive_days
        );

        let cutoff_date = Utc::now() - Duration::days(self.order_archive_days);

        // First, get the orders to archive
        let select_query = r#"
            SELECT order_id, symbol, side, quantity, price, order_type, status, strategy_id, created_at, updated_at
            FROM orders 
            WHERE created_at < $1
            ORDER BY created_at ASC
        "#;

        let rows_to_archive = sqlx::query_as::<_, OrderArchiveRow>(select_query)
            .bind(cutoff_date)
            .fetch_all(&self.db_pool)
            .await
            .map_err(|e| {
                AppError::database(format!("Failed to select orders for archival: {}", e))
            })?;

        if rows_to_archive.is_empty() {
            info!("No orders to archive");
            return Ok(ArchiveResult {
                table: "orders".to_string(),
                archived_count: 0,
                cutoff_date,
                archived_details: Vec::new(),
            });
        }

        // Convert to archive format
        let archived_data: Vec<OrderArchive> = rows_to_archive
            .into_iter()
            .map(|row| OrderArchive {
                order_id: row.order_id,
                symbol: row.symbol,
                side: row.side,
                quantity: row.quantity,
                price: row.price,
                order_type: row.order_type,
                status: row.status,
                strategy_id: row.strategy_id,
                archived_at: Utc::now(),
            })
            .collect();

        // Insert into archive table
        let insert_query = r#"
            INSERT INTO orders_archive (
                order_id, symbol, side, quantity, price, order_type, status, strategy_id, archived_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (order_id) DO NOTHING
        "#;

        for archive_row in &archived_data {
            sqlx::query(insert_query)
                .bind(&archive_row.order_id)
                .bind(&archive_row.symbol)
                .bind(&archive_row.side)
                .bind(archive_row.quantity)
                .bind(archive_row.price)
                .bind(&archive_row.order_type)
                .bind(&archive_row.status)
                .bind(&archive_row.strategy_id)
                .bind(archive_row.archived_at)
                .execute(&self.db_pool)
                .await
                .map_err(|e| {
                    AppError::database(format!("Failed to insert archive record: {}", e))
                })?;
        }

        // Delete archived orders from main table
        let delete_query = r#"
            DELETE FROM orders 
            WHERE created_at < $1
        "#;

        sqlx::query(delete_query)
            .bind(cutoff_date)
            .execute(&self.db_pool)
            .await
            .map_err(|e| AppError::database(format!("Failed to delete archived orders: {}", e)))?;

        let archived_count = archived_data.len() as i64;

        info!("Archived {} order records", archived_count);

        Ok(ArchiveResult {
            table: "orders".to_string(),
            archived_count,
            cutoff_date,
            archived_details: archived_data
                .into_iter()
                .map(ArchiveDetail::Order)
                .collect(),
        })
    }

    /// Run all cleanup operations
    pub async fn run_cleanup(&self) -> AppResult<Vec<CleanupResult>> {
        let mut results = Vec::new();

        // Clean up market data
        if let Ok(result) = self.cleanup_expired_market_data().await {
            results.push(result);
        }

        // Clean up orders
        if let Ok(result) = self.cleanup_expired_orders().await {
            results.push(result);
        }

        // Clean up positions
        if let Ok(result) = self.cleanup_expired_positions().await {
            results.push(result);
        }

        Ok(results)
    }

    /// Run all archival operations
    pub async fn run_archival(&self) -> AppResult<Vec<ArchiveResult>> {
        let mut results = Vec::new();

        // Archive old market data
        if let Ok(result) = self.archive_old_market_data().await {
            results.push(result);
        }

        // Archive old orders
        if let Ok(result) = self.archive_old_orders().await {
            results.push(result);
        }

        Ok(results)
    }

    /// Run all lifecycle operations (cleanup + archival)
    pub async fn run_lifecycle(&self) -> AppResult<LifecycleResult> {
        info!("Running data lifecycle operations");

        let cleanup_results = self.run_cleanup().await?;
        let archival_results = self.run_archival().await?;

        Ok(LifecycleResult {
            cleanup_results,
            archival_results,
            executed_at: Utc::now(),
        })
    }
}

/// Retention settings configuration
#[derive(Debug, Clone, Serialize)]
pub struct RetentionSettings {
    pub market_data_retention_days: i64,
    pub order_retention_days: i64,
    pub position_retention_days: i64,
    pub market_data_archive_days: i64,
    pub order_archive_days: i64,
}

/// Result of a cleanup operation
#[derive(Debug, Clone)]
pub struct CleanupResult {
    pub table: String,
    pub deleted_count: i64,
    pub cutoff_date: DateTime<Utc>,
}

/// Result of an archival operation
#[derive(Debug, Clone)]
pub struct ArchiveResult {
    pub table: String,
    pub archived_count: i64,
    pub cutoff_date: DateTime<Utc>,
    pub archived_details: Vec<ArchiveDetail>,
}

/// Result of a full lifecycle operation
#[derive(Debug, Clone)]
pub struct LifecycleResult {
    pub cleanup_results: Vec<CleanupResult>,
    pub archival_results: Vec<ArchiveResult>,
    pub executed_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub enum ArchiveDetail {
    MarketData(MarketDataArchive),
    Order(OrderArchive),
}

/// Market data archive record
#[derive(Debug, Clone)]
pub struct MarketDataArchive {
    pub symbol: String,
    pub timestamp: DateTime<Utc>,
    pub price: rust_decimal::Decimal,
    pub volume: i64,
    pub bid_price: Option<rust_decimal::Decimal>,
    pub ask_price: Option<rust_decimal::Decimal>,
    pub bid_size: Option<i64>,
    pub ask_size: Option<i64>,
    pub archived_at: DateTime<Utc>,
}

/// Order archive record
#[derive(Debug, Clone)]
pub struct OrderArchive {
    pub order_id: String,
    pub symbol: String,
    pub side: String,
    pub quantity: i64,
    pub price: Option<rust_decimal::Decimal>,
    pub order_type: String,
    pub status: String,
    pub strategy_id: Option<String>,
    pub archived_at: DateTime<Utc>,
}

/// Database row structures for archival
#[derive(sqlx::FromRow)]
struct MarketDataArchiveRow {
    symbol: String,
    timestamp: DateTime<Utc>,
    price: rust_decimal::Decimal,
    volume: i64,
    bid_price: Option<rust_decimal::Decimal>,
    ask_price: Option<rust_decimal::Decimal>,
    bid_size: Option<i64>,
    ask_size: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct OrderArchiveRow {
    order_id: String,
    symbol: String,
    side: String,
    quantity: i64,
    price: Option<rust_decimal::Decimal>,
    order_type: String,
    status: String,
    strategy_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retention_settings() {
        let settings = RetentionSettings {
            market_data_retention_days: 90,
            order_retention_days: 365,
            position_retention_days: 365,
            market_data_archive_days: 30,
            order_archive_days: 90,
        };

        assert_eq!(settings.market_data_retention_days, 90);
        assert_eq!(settings.order_retention_days, 365);
        assert_eq!(settings.position_retention_days, 365);
        assert_eq!(settings.market_data_archive_days, 30);
        assert_eq!(settings.order_archive_days, 90);
    }

    #[test]
    fn test_cleanup_result() {
        let result = CleanupResult {
            table: "market_data".to_string(),
            deleted_count: 100,
            cutoff_date: Utc::now(),
        };

        assert_eq!(result.table, "market_data");
        assert_eq!(result.deleted_count, 100);
    }

    #[test]
    fn test_archive_result() {
        let result = ArchiveResult {
            table: "market_data".to_string(),
            archived_count: 50,
            cutoff_date: Utc::now(),
            archived_details: Vec::new(),
        };

        assert_eq!(result.table, "market_data");
        assert_eq!(result.archived_count, 50);
    }

    #[test]
    fn test_lifecycle_result() {
        let result = LifecycleResult {
            cleanup_results: Vec::new(),
            archival_results: Vec::new(),
            executed_at: Utc::now(),
        };

        assert!(result.cleanup_results.is_empty());
        assert!(result.archival_results.is_empty());
    }
}
