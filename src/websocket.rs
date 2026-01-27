use crate::error::AppResult;
use crate::events::{EventBus, PlatformEvent};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, error, info, warn};

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum WSMessage {
    // Server -> Client
    MarketData(MarketDataUpdate),
    Signal(SignalUpdate),
    OrderUpdate(OrderUpdate),
    PortfolioUpdate(PortfolioUpdate),
    Error(ErrorMessage),
    Heartbeat,
    Subscribed { channels: Vec<String> },
    Unsubscribed { channels: Vec<String> },

    // Client -> Server
    Subscribe { channels: Vec<String> },
    Unsubscribe { channels: Vec<String> },
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketDataUpdate {
    pub symbol: String,
    pub price: String,
    pub volume: i64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalUpdate {
    pub strategy_id: String,
    pub symbol: String,
    pub signal_type: String,
    pub strength: f64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderUpdate {
    pub order_id: String,
    pub symbol: String,
    pub status: String,
    pub filled_qty: Option<i64>,
    pub avg_price: Option<String>,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioUpdate {
    pub portfolio_id: String,
    pub total_value: String,
    pub cash: String,
    pub pnl: String,
    pub pnl_percent: f64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorMessage {
    pub code: String,
    pub message: String,
}

/// WebSocket connection manager
pub struct WSManager {
    /// Broadcast channel for sending messages to all connected clients
    broadcast_tx: broadcast::Sender<WSMessage>,
    /// Active connections with their subscriptions
    connections: RwLock<HashMap<String, ClientSubscription>>,
}

#[derive(Debug, Clone)]
struct ClientSubscription {
    channels: Vec<String>,
}

impl WSManager {
    pub fn new(capacity: usize) -> Self {
        let (broadcast_tx, _) = broadcast::channel(capacity);
        Self {
            broadcast_tx,
            connections: RwLock::new(HashMap::new()),
        }
    }

    /// Subscribe a client to receive broadcasts
    pub fn subscribe(&self) -> broadcast::Receiver<WSMessage> {
        self.broadcast_tx.subscribe()
    }

    /// Broadcast a message to all connected clients
    pub fn broadcast(&self, msg: WSMessage) -> Result<usize, broadcast::error::SendError<WSMessage>> {
        self.broadcast_tx.send(msg)
    }

    /// Register a new connection
    pub async fn register(&self, conn_id: String) {
        let mut connections = self.connections.write().await;
        connections.insert(
            conn_id.clone(),
            ClientSubscription {
                channels: Vec::new(),
            },
        );
        info!("WebSocket client registered: {}", conn_id);
    }

    /// Unregister a connection
    pub async fn unregister(&self, conn_id: &str) {
        let mut connections = self.connections.write().await;
        connections.remove(conn_id);
        info!("WebSocket client unregistered: {}", conn_id);
    }

    /// Update client subscriptions
    pub async fn update_subscription(&self, conn_id: &str, channels: Vec<String>) {
        let mut connections = self.connections.write().await;
        if let Some(sub) = connections.get_mut(conn_id) {
            sub.channels = channels;
        }
    }

    /// Get active connection count
    pub async fn connection_count(&self) -> usize {
        self.connections.read().await.len()
    }

    /// Broadcast platform events
    pub fn broadcast_event(&self, event: &PlatformEvent) {
        let msg = match event {
            PlatformEvent::MarketData { data } => WSMessage::MarketData(MarketDataUpdate {
                symbol: data.symbol.clone(),
                price: data.price.to_string(),
                volume: data.volume,
                timestamp: data.timestamp,
            }),
            PlatformEvent::SignalGenerated { signal } => WSMessage::Signal(SignalUpdate {
                strategy_id: signal.strategy_id.clone(),
                symbol: signal.symbol.clone(),
                signal_type: format!("{:?}", signal.signal_type),
                strength: signal.strength,
                timestamp: signal.generated_at,
            }),
            PlatformEvent::OrderFilled {
                order_id, symbol, filled_quantity, avg_price, ..
            } => WSMessage::OrderUpdate(OrderUpdate {
                order_id: order_id.to_string(),
                symbol: symbol.clone(),
                status: "filled".to_string(),
                filled_qty: Some(*filled_quantity),
                avg_price: Some(avg_price.to_string()),
                timestamp: chrono::Utc::now(),
            }),
            PlatformEvent::OrderRejected {
                order_id, symbol, reason, ..
            } => WSMessage::OrderUpdate(OrderUpdate {
                order_id: order_id.to_string(),
                symbol: symbol.clone(),
                status: format!("rejected: {}", reason),
                filled_qty: None,
                avg_price: None,
                timestamp: chrono::Utc::now(),
            }),
            _ => return, // Skip other events
        };

        if let Err(e) = self.broadcast(msg) {
            debug!("No WebSocket clients connected: {}", e);
        }
    }
}

/// WebSocket handler state
#[derive(Clone)]
pub struct WSState {
    pub manager: Arc<WSManager>,
    pub event_bus: Arc<EventBus>,
}

/// WebSocket upgrade handler
pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<WSState>) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handle individual WebSocket connection
async fn handle_socket(socket: WebSocket, state: WSState) {
    let conn_id = uuid::Uuid::new_v4().to_string();
    info!("New WebSocket connection: {}", conn_id);

    // Register connection
    state.manager.register(conn_id.clone()).await;

    // Split socket into sender and receiver
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to broadcasts
    let mut broadcast_rx = state.manager.subscribe();

    // Spawn task to forward broadcasts to client
    let conn_id_clone = conn_id.clone();
    let forward_task = tokio::spawn(async move {
        while let Ok(msg) = broadcast_rx.recv().await {
            match serde_json::to_string(&msg) {
                Ok(json) => {
                    if sender.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    error!("Failed to serialize message: {}", e);
                }
            }
        }
    });

    // Handle incoming messages
    let manager = state.manager.clone();
    while let Some(result) = receiver.next().await {
        match result {
            Ok(Message::Text(text)) => {
                match serde_json::from_str::<WSMessage>(&text) {
                    Ok(msg) => handle_client_message(&manager, &conn_id, msg).await,
                    Err(e) => {
                        warn!("Invalid message from {}: {}", conn_id, e);
                    }
                }
            }
            Ok(Message::Ping(data)) => {
                debug!("Ping from {}", conn_id);
                // Pong is handled automatically by axum
            }
            Ok(Message::Close(_)) => {
                info!("Client {} closed connection", conn_id);
                break;
            }
            Err(e) => {
                error!("WebSocket error from {}: {}", conn_id, e);
                break;
            }
            _ => {}
        }
    }

    // Cleanup
    forward_task.abort();
    state.manager.unregister(&conn_id).await;
    info!("WebSocket connection closed: {}", conn_id);
}

/// Handle messages from client
async fn handle_client_message(manager: &WSManager, conn_id: &str, msg: WSMessage) {
    match msg {
        WSMessage::Subscribe { channels } => {
            info!("Client {} subscribing to: {:?}", conn_id, channels);
            manager.update_subscription(conn_id, channels.clone()).await;
            // Send confirmation would require direct send, skipping for broadcast model
        }
        WSMessage::Unsubscribe { channels } => {
            info!("Client {} unsubscribing from: {:?}", conn_id, channels);
            // Update subscription logic
        }
        WSMessage::Ping => {
            debug!("Ping from client {}", conn_id);
            // Could send Heartbeat back through broadcast
        }
        _ => {
            warn!("Unexpected message type from client {}", conn_id);
        }
    }
}

/// Start heartbeat task for keeping connections alive
pub fn start_heartbeat(manager: Arc<WSManager>, interval_secs: u64) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
        loop {
            interval.tick().await;
            if let Err(e) = manager.broadcast(WSMessage::Heartbeat) {
                debug!("No clients for heartbeat: {}", e);
            }
        }
    });
}
