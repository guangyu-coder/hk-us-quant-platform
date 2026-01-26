use crate::error::{AppError, AppResult};
use crate::types::{MarketData, Order, Position, Signal};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use redis::{streams::StreamReadOptions, AsyncCommands, Client as RedisClient};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Event types for the trading platform
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum PlatformEvent {
    // Data events
    MarketDataReceived {
        data: MarketData,
    },
    DataQualityAlert {
        symbol: String,
        message: String,
    },
    DataSourceDisconnected {
        source: String,
        timestamp: DateTime<Utc>,
    },

    // Strategy events
    SignalGenerated {
        signal: Signal,
    },
    BacktestCompleted {
        strategy_id: String,
        result: serde_json::Value,
    },
    StrategyError {
        strategy_id: String,
        error: String,
    },

    // Execution events
    OrderCreated {
        order: Order,
    },
    OrderFilled {
        order_id: Uuid,
        filled_quantity: i64,
        fill_price: rust_decimal::Decimal,
    },
    OrderRejected {
        order_id: Uuid,
        reason: String,
    },
    OrderCancelled {
        order_id: Uuid,
    },

    // Portfolio events
    PositionUpdated {
        position: Position,
    },
    PnlCalculated {
        portfolio_id: String,
        total_pnl: rust_decimal::Decimal,
    },
    PortfolioLimitExceeded {
        portfolio_id: String,
        limit_type: String,
        current_value: f64,
        limit_value: f64,
    },

    // Risk events
    RiskCheckPassed {
        order_id: Uuid,
    },
    RiskCheckFailed {
        order_id: Uuid,
        reason: String,
    },
    RiskAlertTriggered {
        alert_type: String,
        message: String,
        severity: String,
    },

    // System events
    ServiceStarted {
        service_name: String,
    },
    ServiceStopped {
        service_name: String,
    },
    HealthCheckFailed {
        service_name: String,
        error: String,
    },
}

impl PlatformEvent {
    /// Get the event type as a string for routing
    pub fn event_type(&self) -> &'static str {
        match self {
            PlatformEvent::MarketDataReceived { .. } => "market_data_received",
            PlatformEvent::DataQualityAlert { .. } => "data_quality_alert",
            PlatformEvent::DataSourceDisconnected { .. } => "data_source_disconnected",
            PlatformEvent::SignalGenerated { .. } => "signal_generated",
            PlatformEvent::BacktestCompleted { .. } => "backtest_completed",
            PlatformEvent::StrategyError { .. } => "strategy_error",
            PlatformEvent::OrderCreated { .. } => "order_created",
            PlatformEvent::OrderFilled { .. } => "order_filled",
            PlatformEvent::OrderRejected { .. } => "order_rejected",
            PlatformEvent::OrderCancelled { .. } => "order_cancelled",
            PlatformEvent::PositionUpdated { .. } => "position_updated",
            PlatformEvent::PnlCalculated { .. } => "pnl_calculated",
            PlatformEvent::PortfolioLimitExceeded { .. } => "portfolio_limit_exceeded",
            PlatformEvent::RiskCheckPassed { .. } => "risk_check_passed",
            PlatformEvent::RiskCheckFailed { .. } => "risk_check_failed",
            PlatformEvent::RiskAlertTriggered { .. } => "risk_alert_triggered",
            PlatformEvent::ServiceStarted { .. } => "service_started",
            PlatformEvent::ServiceStopped { .. } => "service_stopped",
            PlatformEvent::HealthCheckFailed { .. } => "health_check_failed",
        }
    }

    /// Get the stream name for this event type
    pub fn stream_name(&self) -> String {
        format!("platform:{}", self.event_type())
    }
}

/// Event handler trait for processing events
#[async_trait]
pub trait EventHandler: Send + Sync {
    async fn handle_event(&self, event: &PlatformEvent) -> AppResult<()>;
    fn interested_events(&self) -> Vec<&'static str>;
}

/// Event bus for managing event publishing and subscription
pub struct EventBus {
    redis_client: RedisClient,
    local_sender: broadcast::Sender<PlatformEvent>,
    _local_receiver: broadcast::Receiver<PlatformEvent>,
}

impl EventBus {
    /// Create a new event bus
    pub async fn new(redis_client: RedisClient) -> AppResult<Self> {
        let (local_sender, local_receiver) = broadcast::channel(1000);

        Ok(Self {
            redis_client,
            local_sender,
            _local_receiver: local_receiver,
        })
    }

    /// Publish an event to both local and Redis streams
    pub async fn publish(&self, event: PlatformEvent) -> AppResult<()> {
        let event_type = event.event_type();
        let stream_name = event.stream_name();

        // Publish to local subscribers first
        if let Err(e) = self.local_sender.send(event.clone()) {
            warn!("Failed to send event to local subscribers: {}", e);
        }

        // Publish to Redis stream
        let mut conn = self
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| AppError::Redis(e))?;

        let event_data = serde_json::to_string(&event).map_err(|e| AppError::Serialization(e))?;

        let _fields = vec![("event_type", event_type), ("data", &event_data)];

        let timestamp = Utc::now().to_rfc3339();
        let fields_with_timestamp = vec![
            ("event_type", event_type),
            ("data", &event_data),
            ("timestamp", &timestamp),
        ];

        conn.xadd::<_, _, _, _, ()>(&stream_name, "*", &fields_with_timestamp)
            .await
            .map_err(|e| AppError::Redis(e))?;

        debug!("Published event {} to stream {}", event_type, stream_name);
        Ok(())
    }

    /// Subscribe to events locally
    pub fn subscribe_local(&self) -> broadcast::Receiver<PlatformEvent> {
        self.local_sender.subscribe()
    }

    /// Subscribe to events from Redis streams
    pub async fn subscribe_redis(&self, event_types: Vec<&str>) -> AppResult<EventSubscriber> {
        let conn = self
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| AppError::Redis(e))?;

        let streams: Vec<String> = event_types
            .iter()
            .map(|event_type| format!("platform:{}", event_type))
            .collect();

        Ok(EventSubscriber {
            connection: conn,
            streams,
            last_ids: HashMap::new(),
        })
    }

    /// Register an event handler for specific event types
    pub async fn register_handler<H>(&self, handler: H) -> AppResult<()>
    where
        H: EventHandler + 'static,
    {
        let interested_events = handler.interested_events();
        let mut subscriber = self.subscribe_redis(interested_events).await?;

        tokio::spawn(async move {
            loop {
                match subscriber.read_events().await {
                    Ok(events) => {
                        for event in events {
                            if let Err(e) = handler.handle_event(&event).await {
                                error!("Error handling event: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        error!("Error reading events: {}", e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    }
                }
            }
        });

        Ok(())
    }
}

/// Event subscriber for reading from Redis streams
pub struct EventSubscriber {
    connection: redis::aio::MultiplexedConnection,
    streams: Vec<String>,
    last_ids: HashMap<String, String>,
}

impl EventSubscriber {
    /// Read events from subscribed streams
    pub async fn read_events(&mut self) -> AppResult<Vec<PlatformEvent>> {
        let stream_keys: Vec<String> = self.streams.iter().map(|stream| stream.clone()).collect();

        let stream_ids: Vec<String> = self
            .streams
            .iter()
            .map(|stream| {
                self.last_ids
                    .get(stream)
                    .cloned()
                    .unwrap_or_else(|| "$".to_string())
            })
            .collect();

        let opts = StreamReadOptions::default().count(10).block(1000);

        let results: redis::streams::StreamReadReply = self
            .connection
            .xread_options(&stream_keys, &stream_ids, &opts)
            .await
            .map_err(|e| AppError::Redis(e))?;

        let mut events = Vec::new();

        for stream_result in results.keys {
            let stream_name = &stream_result.key;

            for stream_id in stream_result.ids {
                // Update last ID for this stream
                self.last_ids
                    .insert(stream_name.clone(), stream_id.id.clone());

                // Parse event data
                if let Some(data_field) = stream_id.map.get("data") {
                    if let redis::Value::Data(data_bytes) = data_field {
                        if let Ok(data_str) = std::str::from_utf8(data_bytes) {
                            match serde_json::from_str::<PlatformEvent>(data_str) {
                                Ok(event) => events.push(event),
                                Err(e) => {
                                    warn!(
                                        "Failed to deserialize event from stream {}: {}",
                                        stream_name, e
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(events)
    }
}

/// Event metrics for monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventMetrics {
    pub total_events_published: u64,
    pub total_events_consumed: u64,
    pub events_by_type: HashMap<String, u64>,
    pub last_event_timestamp: Option<DateTime<Utc>>,
    pub error_count: u64,
}

impl Default for EventMetrics {
    fn default() -> Self {
        Self {
            total_events_published: 0,
            total_events_consumed: 0,
            events_by_type: HashMap::new(),
            last_event_timestamp: None,
            error_count: 0,
        }
    }
}

/// Event store for event sourcing and replay
pub struct EventStore {
    redis_client: RedisClient,
}

impl EventStore {
    pub fn new(redis_client: RedisClient) -> Self {
        Self { redis_client }
    }

    /// Get events from a specific stream within a time range
    pub async fn get_events(
        &self,
        stream_name: &str,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
    ) -> AppResult<Vec<PlatformEvent>> {
        let mut conn = self
            .redis_client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| AppError::Redis(e))?;

        let start_id = format!("{}-0", start_time.timestamp_millis());
        let end_id = format!("{}-0", end_time.timestamp_millis());

        let results: redis::streams::StreamRangeReply = conn
            .xrange(stream_name, &start_id, &end_id)
            .await
            .map_err(|e| AppError::Redis(e))?;

        let mut events = Vec::new();
        for stream_id in results.ids {
            if let Some(data_field) = stream_id.map.get("data") {
                if let redis::Value::Data(data_bytes) = data_field {
                    if let Ok(data_str) = std::str::from_utf8(data_bytes) {
                        match serde_json::from_str::<PlatformEvent>(data_str) {
                            Ok(event) => events.push(event),
                            Err(e) => {
                                warn!("Failed to deserialize event: {}", e);
                            }
                        }
                    }
                }
            }
        }

        Ok(events)
    }

    /// Replay events from a specific time
    pub async fn replay_events(
        &self,
        stream_name: &str,
        from_time: DateTime<Utc>,
        handler: Box<dyn EventHandler>,
    ) -> AppResult<()> {
        let events = self.get_events(stream_name, from_time, Utc::now()).await?;

        info!(
            "Replaying {} events from stream {}",
            events.len(),
            stream_name
        );

        for event in events {
            if let Err(e) = handler.handle_event(&event).await {
                error!("Error replaying event: {}", e);
            }
        }

        Ok(())
    }
}
