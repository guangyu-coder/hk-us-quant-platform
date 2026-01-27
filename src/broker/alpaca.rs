use super::{
    Broker, BrokerAccount, BrokerConfig, BrokerOrderResult, BrokerOrderStatus, BrokerPosition,
    BrokerQuote,
};
use crate::error::{AppError, AppResult};
use crate::types::{Order, OrderSide, OrderType};
use async_trait::async_trait;
use rust_decimal::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{debug, info, warn};

const ALPACA_PAPER_URL: &str = "https://paper-api.alpaca.markets";
const ALPACA_LIVE_URL: &str = "https://api.alpaca.markets";
const ALPACA_DATA_URL: &str = "https://data.alpaca.markets";

/// Alpaca broker implementation
pub struct AlpacaBroker {
    client: reqwest::Client,
    base_url: String,
    data_url: String,
    api_key: String,
    api_secret: String,
    paper_trading: bool,
}

impl AlpacaBroker {
    pub async fn new(config: &BrokerConfig) -> AppResult<Self> {
        let base_url = config.base_url.clone().unwrap_or_else(|| {
            if config.paper_trading {
                ALPACA_PAPER_URL.to_string()
            } else {
                ALPACA_LIVE_URL.to_string()
            }
        });

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| AppError::broker(format!("Failed to create HTTP client: {}", e)))?;

        let broker = Self {
            client,
            base_url,
            data_url: ALPACA_DATA_URL.to_string(),
            api_key: config.api_key.clone(),
            api_secret: config.api_secret.clone(),
            paper_trading: config.paper_trading,
        };

        // Verify connection
        if broker.is_connected().await {
            info!(
                "Alpaca broker connected ({})",
                if config.paper_trading { "paper" } else { "live" }
            );
        } else {
            warn!("Alpaca broker connection could not be verified");
        }

        Ok(broker)
    }

    fn auth_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "APCA-API-KEY-ID",
            self.api_key.parse().unwrap_or_default(),
        );
        headers.insert(
            "APCA-API-SECRET-KEY",
            self.api_secret.parse().unwrap_or_default(),
        );
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            "application/json".parse().unwrap(),
        );
        headers
    }

    async fn api_get<T: for<'de> Deserialize<'de>>(&self, endpoint: &str) -> AppResult<T> {
        let url = format!("{}{}", self.base_url, endpoint);
        debug!("Alpaca API GET: {}", url);

        let response = self
            .client
            .get(&url)
            .headers(self.auth_headers())
            .send()
            .await
            .map_err(|e| AppError::broker(format!("API request failed: {}", e)))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| AppError::broker(format!("Failed to read response: {}", e)))?;

        if !status.is_success() {
            return Err(AppError::broker(format!(
                "API error ({}): {}",
                status, body
            )));
        }

        serde_json::from_str(&body)
            .map_err(|e| AppError::broker(format!("Failed to parse response: {} - {}", e, body)))
    }

    async fn api_post<T: for<'de> Deserialize<'de>, B: Serialize>(
        &self,
        endpoint: &str,
        body: &B,
    ) -> AppResult<T> {
        let url = format!("{}{}", self.base_url, endpoint);
        debug!("Alpaca API POST: {}", url);

        let response = self
            .client
            .post(&url)
            .headers(self.auth_headers())
            .json(body)
            .send()
            .await
            .map_err(|e| AppError::broker(format!("API request failed: {}", e)))?;

        let status = response.status();
        let body_text = response
            .text()
            .await
            .map_err(|e| AppError::broker(format!("Failed to read response: {}", e)))?;

        if !status.is_success() {
            return Err(AppError::broker(format!(
                "API error ({}): {}",
                status, body_text
            )));
        }

        serde_json::from_str(&body_text)
            .map_err(|e| AppError::broker(format!("Failed to parse response: {} - {}", e, body_text)))
    }

    async fn api_delete(&self, endpoint: &str) -> AppResult<()> {
        let url = format!("{}{}", self.base_url, endpoint);
        debug!("Alpaca API DELETE: {}", url);

        let response = self
            .client
            .delete(&url)
            .headers(self.auth_headers())
            .send()
            .await
            .map_err(|e| AppError::broker(format!("API request failed: {}", e)))?;

        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(AppError::broker(format!(
                "API error ({}): {}",
                status, body
            )));
        }

        Ok(())
    }

    async fn data_get<T: for<'de> Deserialize<'de>>(&self, endpoint: &str) -> AppResult<T> {
        let url = format!("{}{}", self.data_url, endpoint);
        debug!("Alpaca Data API GET: {}", url);

        let response = self
            .client
            .get(&url)
            .headers(self.auth_headers())
            .send()
            .await
            .map_err(|e| AppError::broker(format!("Data API request failed: {}", e)))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| AppError::broker(format!("Failed to read response: {}", e)))?;

        if !status.is_success() {
            return Err(AppError::broker(format!(
                "Data API error ({}): {}",
                status, body
            )));
        }

        serde_json::from_str(&body)
            .map_err(|e| AppError::broker(format!("Failed to parse response: {} - {}", e, body)))
    }
}

#[async_trait]
impl Broker for AlpacaBroker {
    fn name(&self) -> &str {
        if self.paper_trading {
            "Alpaca (Paper)"
        } else {
            "Alpaca (Live)"
        }
    }

    async fn is_connected(&self) -> bool {
        match self.api_get::<AlpacaAccount>("/v2/account").await {
            Ok(_) => true,
            Err(e) => {
                warn!("Alpaca connection check failed: {}", e);
                false
            }
        }
    }

    async fn get_account(&self) -> AppResult<BrokerAccount> {
        let account: AlpacaAccount = self.api_get("/v2/account").await?;
        Ok(account.into())
    }

    async fn submit_order(&self, order: &Order) -> AppResult<BrokerOrderResult> {
        let alpaca_order = AlpacaOrderRequest {
            symbol: order.symbol.clone(),
            qty: Some(order.quantity.to_string()),
            notional: None,
            side: match order.side {
                OrderSide::Buy => "buy".to_string(),
                OrderSide::Sell => "sell".to_string(),
            },
            order_type: match order.order_type {
                OrderType::Market => "market".to_string(),
                OrderType::Limit => "limit".to_string(),
                OrderType::Stop => "stop".to_string(),
                OrderType::StopLimit => "stop_limit".to_string(),
            },
            time_in_force: "day".to_string(),
            limit_price: order.price.map(|p| p.to_string()),
            stop_price: None,
            extended_hours: Some(false),
            client_order_id: Some(order.id.to_string()),
        };

        let response: AlpacaOrder = self.api_post("/v2/orders", &alpaca_order).await?;

        info!(
            "Alpaca order submitted: {} -> {}",
            order.id, response.id
        );

        Ok(BrokerOrderResult {
            broker_order_id: response.id,
            client_order_id: response.client_order_id.unwrap_or_default(),
            status: parse_alpaca_status(&response.status),
            submitted_at: response.submitted_at.unwrap_or_else(chrono::Utc::now),
        })
    }

    async fn cancel_order(&self, broker_order_id: &str) -> AppResult<()> {
        self.api_delete(&format!("/v2/orders/{}", broker_order_id)).await
    }

    async fn get_order_status(&self, broker_order_id: &str) -> AppResult<BrokerOrderStatus> {
        let order: AlpacaOrder = self
            .api_get(&format!("/v2/orders/{}", broker_order_id))
            .await?;
        Ok(parse_alpaca_status(&order.status))
    }

    async fn get_positions(&self) -> AppResult<Vec<BrokerPosition>> {
        let positions: Vec<AlpacaPosition> = self.api_get("/v2/positions").await?;
        Ok(positions.into_iter().map(|p| p.into()).collect())
    }

    async fn get_position(&self, symbol: &str) -> AppResult<Option<BrokerPosition>> {
        match self
            .api_get::<AlpacaPosition>(&format!("/v2/positions/{}", symbol))
            .await
        {
            Ok(position) => Ok(Some(position.into())),
            Err(e) => {
                if e.to_string().contains("404") {
                    Ok(None)
                } else {
                    Err(e)
                }
            }
        }
    }

    async fn get_quote(&self, symbol: &str) -> AppResult<BrokerQuote> {
        let response: AlpacaQuoteResponse = self
            .data_get(&format!("/v2/stocks/{}/quotes/latest", symbol))
            .await?;

        Ok(BrokerQuote {
            symbol: symbol.to_string(),
            bid_price: parse_decimal(&response.quote.bp),
            bid_size: response.quote.bs,
            ask_price: parse_decimal(&response.quote.ap),
            ask_size: response.quote.as_,
            last_price: parse_decimal(&response.quote.ap), // Use ask as last for quote
            last_size: response.quote.as_,
            timestamp: response.quote.t,
        })
    }

    async fn get_quotes(&self, symbols: &[String]) -> AppResult<HashMap<String, BrokerQuote>> {
        let mut quotes = HashMap::new();
        
        // Alpaca supports batch quotes
        let symbols_param = symbols.join(",");
        let response: AlpacaMultiQuoteResponse = self
            .data_get(&format!("/v2/stocks/quotes/latest?symbols={}", symbols_param))
            .await?;

        for (symbol, quote) in response.quotes {
            quotes.insert(
                symbol.clone(),
                BrokerQuote {
                    symbol,
                    bid_price: parse_decimal(&quote.bp),
                    bid_size: quote.bs,
                    ask_price: parse_decimal(&quote.ap),
                    ask_size: quote.as_,
                    last_price: parse_decimal(&quote.ap),
                    last_size: quote.as_,
                    timestamp: quote.t,
                },
            );
        }

        Ok(quotes)
    }
}

// Alpaca API response structures
#[derive(Debug, Deserialize)]
struct AlpacaAccount {
    id: String,
    status: String,
    currency: String,
    cash: String,
    portfolio_value: String,
    buying_power: String,
    equity: String,
    last_equity: String,
    long_market_value: String,
    short_market_value: String,
    initial_margin: String,
    maintenance_margin: String,
    daytrade_count: i32,
    pattern_day_trader: bool,
    trading_blocked: bool,
    transfers_blocked: bool,
    account_blocked: bool,
}

impl From<AlpacaAccount> for BrokerAccount {
    fn from(a: AlpacaAccount) -> Self {
        BrokerAccount {
            account_id: a.id,
            status: a.status,
            currency: a.currency,
            cash: parse_decimal(&a.cash),
            portfolio_value: parse_decimal(&a.portfolio_value),
            buying_power: parse_decimal(&a.buying_power),
            equity: parse_decimal(&a.equity),
            last_equity: parse_decimal(&a.last_equity),
            long_market_value: parse_decimal(&a.long_market_value),
            short_market_value: parse_decimal(&a.short_market_value),
            initial_margin: parse_decimal(&a.initial_margin),
            maintenance_margin: parse_decimal(&a.maintenance_margin),
            daytrade_count: a.daytrade_count,
            pattern_day_trader: a.pattern_day_trader,
            trading_blocked: a.trading_blocked,
            transfers_blocked: a.transfers_blocked,
            account_blocked: a.account_blocked,
        }
    }
}

#[derive(Debug, Serialize)]
struct AlpacaOrderRequest {
    symbol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    qty: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notional: Option<String>,
    side: String,
    #[serde(rename = "type")]
    order_type: String,
    time_in_force: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit_price: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop_price: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    extended_hours: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_order_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AlpacaOrder {
    id: String,
    client_order_id: Option<String>,
    status: String,
    symbol: String,
    qty: Option<String>,
    filled_qty: Option<String>,
    side: String,
    #[serde(rename = "type")]
    order_type: String,
    time_in_force: String,
    limit_price: Option<String>,
    stop_price: Option<String>,
    filled_avg_price: Option<String>,
    submitted_at: Option<chrono::DateTime<chrono::Utc>>,
    filled_at: Option<chrono::DateTime<chrono::Utc>>,
    expired_at: Option<chrono::DateTime<chrono::Utc>>,
    cancelled_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
struct AlpacaPosition {
    symbol: String,
    qty: String,
    side: String,
    market_value: String,
    cost_basis: String,
    unrealized_pl: String,
    unrealized_plpc: String,
    current_price: String,
    avg_entry_price: String,
    change_today: String,
}

impl From<AlpacaPosition> for BrokerPosition {
    fn from(p: AlpacaPosition) -> Self {
        BrokerPosition {
            symbol: p.symbol,
            quantity: p.qty.parse().unwrap_or(0),
            side: p.side,
            market_value: parse_decimal(&p.market_value),
            cost_basis: parse_decimal(&p.cost_basis),
            unrealized_pl: parse_decimal(&p.unrealized_pl),
            unrealized_plpc: parse_decimal(&p.unrealized_plpc),
            current_price: parse_decimal(&p.current_price),
            avg_entry_price: parse_decimal(&p.avg_entry_price),
            change_today: parse_decimal(&p.change_today),
        }
    }
}

#[derive(Debug, Deserialize)]
struct AlpacaQuoteResponse {
    quote: AlpacaQuote,
}

#[derive(Debug, Deserialize)]
struct AlpacaMultiQuoteResponse {
    quotes: HashMap<String, AlpacaQuote>,
}

#[derive(Debug, Deserialize)]
struct AlpacaQuote {
    bp: String,        // bid price
    bs: i64,           // bid size
    ap: String,        // ask price
    #[serde(rename = "as")]
    as_: i64,          // ask size
    t: chrono::DateTime<chrono::Utc>,  // timestamp
}

fn parse_decimal(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap_or(Decimal::ZERO)
}

fn parse_alpaca_status(status: &str) -> BrokerOrderStatus {
    match status.to_lowercase().as_str() {
        "new" => BrokerOrderStatus::New,
        "accepted" => BrokerOrderStatus::Accepted,
        "pending_new" => BrokerOrderStatus::PendingNew,
        "partially_filled" => BrokerOrderStatus::PartiallyFilled,
        "filled" => BrokerOrderStatus::Filled,
        "done_for_day" => BrokerOrderStatus::DoneForDay,
        "canceled" | "cancelled" => BrokerOrderStatus::Cancelled,
        "expired" => BrokerOrderStatus::Expired,
        "replaced" => BrokerOrderStatus::Replaced,
        "pending_cancel" => BrokerOrderStatus::PendingCancel,
        "pending_replace" => BrokerOrderStatus::PendingReplace,
        "rejected" => BrokerOrderStatus::Rejected,
        "stopped" => BrokerOrderStatus::Stopped,
        "suspended" => BrokerOrderStatus::Suspended,
        "calculated" => BrokerOrderStatus::Calculated,
        "held" => BrokerOrderStatus::Held,
        other => BrokerOrderStatus::Unknown(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_decimal() {
        assert_eq!(parse_decimal("123.45"), Decimal::new(12345, 2));
        assert_eq!(parse_decimal("0"), Decimal::ZERO);
        assert_eq!(parse_decimal("invalid"), Decimal::ZERO);
    }

    #[test]
    fn test_parse_status() {
        assert_eq!(parse_alpaca_status("filled"), BrokerOrderStatus::Filled);
        assert_eq!(parse_alpaca_status("FILLED"), BrokerOrderStatus::Filled);
        assert_eq!(
            parse_alpaca_status("unknown_status"),
            BrokerOrderStatus::Unknown("unknown_status".to_string())
        );
    }
}
