pub mod yahoo_finance;

use crate::error::AppResult;
use crate::types::MarketData;
use async_trait::async_trait;

/// Market data provider trait
#[async_trait]
pub trait MarketDataProvider: Send + Sync {
    /// Get real-time quote
    async fn get_quote(&self, symbol: &str) -> AppResult<MarketData>;

    /// Get historical bars
    async fn get_historical_bars(
        &self,
        symbol: &str,
        start: chrono::DateTime<chrono::Utc>,
        end: chrono::DateTime<chrono::Utc>,
        timeframe: &str,
    ) -> AppResult<Vec<MarketData>>;
}
