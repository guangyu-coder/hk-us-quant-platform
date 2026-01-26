use crate::data::DataService;
use crate::error::AppResult;
use crate::events::{EventHandler, PlatformEvent};
use async_trait::async_trait;
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Event handler for data service events
pub struct DataEventHandler {
    data_service: Arc<DataService>,
}

impl DataEventHandler {
    pub fn new(data_service: Arc<DataService>) -> Self {
        Self { data_service }
    }
}

#[async_trait]
impl EventHandler for DataEventHandler {
    async fn handle_event(&self, event: &PlatformEvent) -> AppResult<()> {
        match event {
            PlatformEvent::MarketDataReceived { data } => {
                debug!("Processing market data received event for {}", data.symbol);

                // Cache the data for quick access
                if let Err(e) = self.data_service.cache_data(data).await {
                    warn!("Failed to cache market data for {}: {}", data.symbol, e);
                }

                info!(
                    "Market data processed for {} at price {}",
                    data.symbol, data.price
                );
                Ok(())
            }

            PlatformEvent::DataQualityAlert { symbol, message } => {
                warn!("Data quality alert for {}: {}", symbol, message);

                // In a real implementation, this might:
                // - Send notifications to administrators
                // - Update data quality metrics
                // - Trigger data source failover

                Ok(())
            }

            PlatformEvent::DataSourceDisconnected { source, timestamp } => {
                warn!("Data source {} disconnected at {}", source, timestamp);

                // In a real implementation, this might:
                // - Attempt to reconnect
                // - Switch to backup data source
                // - Alert operations team

                Ok(())
            }

            _ => {
                // This handler only processes data-related events
                Ok(())
            }
        }
    }

    fn interested_events(&self) -> Vec<&'static str> {
        vec![
            "market_data_received",
            "data_quality_alert",
            "data_source_disconnected",
        ]
    }
}
