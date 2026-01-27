use crate::error::{AppError, AppResult};
use crate::events::{EventBus, PlatformEvent};
use crate::types::MarketData;
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use tracing::{debug, error, info, warn};

type WSStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Debug, Serialize)]
#[serde(tag = "action")]
enum AlpacaWSRequest {
    #[serde(rename = "auth")]
    Auth { key: String, secret: String },
    #[serde(rename = "subscribe")]
    Subscribe { trades: Vec<String>, quotes: Vec<String>, bars: Vec<String> },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "T")]
enum AlpacaWSMessage {
    #[serde(rename = "success")]
    Success { msg: String },
    #[serde(rename = "error")]
    Error { msg: String, code: i32 },
    #[serde(rename = "subscription")]
    Subscription { trades: Vec<String>, quotes: Vec<String>, bars: Vec<String> },
    #[serde(rename = "t")]
    Trade(AlpacaTrade),
    #[serde(rename = "q")]
    Quote(AlpacaQuote),
    #[serde(rename = "b")]
    Bar(AlpacaBar),
}

#[derive(Debug, Deserialize)]
struct AlpacaTrade {
    #[serde(rename = "S")]
    symbol: String,
    #[serde(rename = "p")]
    price: f64,
    #[serde(rename = "s")]
    size: i64,
    #[serde(rename = "t")]
    timestamp: String,
}

#[derive(Debug, Deserialize)]
struct AlpacaQuote {
    #[serde(rename = "S")]
    symbol: String,
    #[serde(rename = "bp")]
    bid_price: f64,
    #[serde(rename = "ap")]
    ask_price: f64,
    #[serde(rename = "bs")]
    bid_size: i64,
    #[serde(rename = "as")]
    ask_size: i64,
    #[serde(rename = "t")]
    timestamp: String,
}

#[derive(Debug, Deserialize)]
struct AlpacaBar {
    #[serde(rename = "S")]
    symbol: String,
    #[serde(rename = "o")]
    open: f64,
    #[serde(rename = "h")]
    high: f64,
    #[serde(rename = "l")]
    low: f64,
    #[serde(rename = "c")]
    close: f64,
    #[serde(rename = "v")]
    volume: i64,
    #[serde(rename = "t")]
    timestamp: String,
}

pub struct AlpacaStreamClient {
    api_key: String,
    api_secret: String,
    event_bus: Arc<EventBus>,
    is_paper: bool,
}

impl AlpacaStreamClient {
    pub fn new(api_key: String, api_secret: String, event_bus: Arc<EventBus>, is_paper: bool) -> Self {
        Self {
            api_key,
            api_secret,
            event_bus,
            is_paper,
        }
    }

    /// Start streaming market data
    pub async fn start(&self, symbols: Vec<String>) -> AppResult<()> {
        let ws_url = if self.is_paper {
            "wss://stream.data.alpaca.markets/v2/iex"
        } else {
            "wss://stream.data.alpaca.markets/v2/iex"
        };

        info!("Connecting to Alpaca data stream: {}", ws_url);

        let (ws_stream, _) = connect_async(ws_url)
            .await
            .map_err(|e| AppError::WebSocket(format!("Connection failed: {}", e)))?;

        info!("Connected to Alpaca WebSocket");

        let (mut write, mut read) = ws_stream.split();

        // Authenticate
        let auth_msg = AlpacaWSRequest::Auth {
            key: self.api_key.clone(),
            secret: self.api_secret.clone(),
        };
        let auth_json = serde_json::to_string(&auth_msg)
            .map_err(|e| AppError::Serialization(e))?;
        
        write
            .send(Message::Text(auth_json))
            .await
            .map_err(|e| AppError::WebSocket(format!("Auth send failed: {}", e)))?;

        debug!("Authentication sent");

        // Wait for auth response
        if let Some(Ok(Message::Text(text))) = read.next().await {
            debug!("Auth response: {}", text);
            let messages: Vec<AlpacaWSMessage> = serde_json::from_str(&text)
                .map_err(|e| AppError::Serialization(e))?;
            
            for msg in messages {
                if let AlpacaWSMessage::Error { msg, code } = msg {
                    return Err(AppError::BrokerApi(format!("Auth failed: {} (code {})", msg, code)));
                }
            }
        }

        // Subscribe to symbols
        let subscribe_msg = AlpacaWSRequest::Subscribe {
            trades: symbols.clone(),
            quotes: symbols.clone(),
            bars: Vec::new(), // Can add bar subscriptions if needed
        };
        let subscribe_json = serde_json::to_string(&subscribe_msg)
            .map_err(|e| AppError::Serialization(e))?;
        
        write
            .send(Message::Text(subscribe_json))
            .await
            .map_err(|e| AppError::WebSocket(format!("Subscribe send failed: {}", e)))?;

        info!("Subscribed to symbols: {:?}", symbols);

        let event_bus = self.event_bus.clone();

        // Process incoming messages
        while let Some(result) = read.next().await {
            match result {
                Ok(Message::Text(text)) => {
                    if let Err(e) = Self::handle_message(&text, event_bus.clone()).await {
                        warn!("Error handling message: {}", e);
                    }
                }
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {
                    debug!("Received ping/pong");
                }
                Ok(Message::Close(_)) => {
                    info!("WebSocket closed by server");
                    break;
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    break;
                }
                _ => {}
            }
        }

        Ok(())
    }

    async fn handle_message(text: &str, event_bus: Arc<EventBus>) -> AppResult<()> {
        let messages: Vec<AlpacaWSMessage> = serde_json::from_str(text)
            .map_err(|e| AppError::Serialization(e))?;

        for msg in messages {
            match msg {
                AlpacaWSMessage::Trade(trade) => {
                    let market_data = MarketData {
                        symbol: trade.symbol.clone(),
                        timestamp: DateTime::parse_from_rfc3339(&trade.timestamp)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now()),
                        price: Decimal::from_str(&trade.price.to_string()).unwrap_or(Decimal::ZERO),
                        volume: trade.size,
                        bid_price: None,
                        ask_price: None,
                        bid_size: None,
                        ask_size: None,
                        open_price: None,
                        high_price: None,
                        low_price: None,
                        previous_close: None,
                        market_cap: None,
                        pe_ratio: None,
                        data_source: Some("Alpaca".to_string()),
                        exchange: Some("IEX".to_string()),
                    };

                    event_bus
                        .publish(PlatformEvent::MarketDataReceived { data: market_data })
                        .await?;
                }
                AlpacaWSMessage::Quote(quote) => {
                    let market_data = MarketData {
                        symbol: quote.symbol.clone(),
                        timestamp: DateTime::parse_from_rfc3339(&quote.timestamp)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now()),
                        price: Decimal::from_str(&((quote.bid_price + quote.ask_price) / 2.0).to_string())
                            .unwrap_or(Decimal::ZERO),
                        volume: 0,
                        bid_price: Decimal::from_str(&quote.bid_price.to_string()).ok(),
                        ask_price: Decimal::from_str(&quote.ask_price.to_string()).ok(),
                        bid_size: Some(quote.bid_size),
                        ask_size: Some(quote.ask_size),
                        open_price: None,
                        high_price: None,
                        low_price: None,
                        previous_close: None,
                        market_cap: None,
                        pe_ratio: None,
                        data_source: Some("Alpaca".to_string()),
                        exchange: Some("IEX".to_string()),
                    };

                    event_bus
                        .publish(PlatformEvent::MarketDataReceived { data: market_data })
                        .await?;
                }
                AlpacaWSMessage::Bar(bar) => {
                    let market_data = MarketData {
                        symbol: bar.symbol.clone(),
                        timestamp: DateTime::parse_from_rfc3339(&bar.timestamp)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now()),
                        price: Decimal::from_str(&bar.close.to_string()).unwrap_or(Decimal::ZERO),
                        volume: bar.volume,
                        bid_price: None,
                        ask_price: None,
                        bid_size: None,
                        ask_size: None,
                        open_price: Decimal::from_str(&bar.open.to_string()).ok(),
                        high_price: Decimal::from_str(&bar.high.to_string()).ok(),
                        low_price: Decimal::from_str(&bar.low.to_string()).ok(),
                        previous_close: None,
                        market_cap: None,
                        pe_ratio: None,
                        data_source: Some("Alpaca".to_string()),
                        exchange: Some("IEX".to_string()),
                    };

                    event_bus
                        .publish(PlatformEvent::MarketDataReceived { data: market_data })
                        .await?;
                }
                AlpacaWSMessage::Success { msg } => {
                    debug!("Success: {}", msg);
                }
                AlpacaWSMessage::Error { msg, code } => {
                    warn!("Error from Alpaca: {} (code {})", msg, code);
                }
                AlpacaWSMessage::Subscription { trades, quotes, bars } => {
                    info!("Subscription confirmed - trades: {:?}, quotes: {:?}, bars: {:?}", 
                          trades, quotes, bars);
                }
            }
        }

        Ok(())
    }
}
