use crate::error::{AppError, AppResult};
use crate::types::MarketData;
use chrono::{DateTime, Utc};
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;
use std::str::FromStr;

#[derive(Debug, Deserialize)]
struct YahooQuoteResponse {
    chart: YahooChart,
}

#[derive(Debug, Deserialize)]
struct YahooChart {
    result: Option<Vec<YahooResult>>,
    error: Option<YahooError>,
}

#[derive(Debug, Deserialize)]
struct YahooError {
    description: String,
}

#[derive(Debug, Deserialize)]
struct YahooResult {
    meta: YahooMeta,
    timestamp: Option<Vec<i64>>,
    indicators: YahooIndicators,
}

#[derive(Debug, Deserialize)]
struct YahooMeta {
    symbol: String,
    #[serde(rename = "regularMarketPrice")]
    regular_market_price: Option<f64>,
    #[serde(rename = "previousClose")]
    previous_close: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct YahooIndicators {
    quote: Vec<YahooQuote>,
}

#[derive(Debug, Deserialize)]
struct YahooQuote {
    open: Option<Vec<Option<f64>>>,
    high: Option<Vec<Option<f64>>>,
    low: Option<Vec<Option<f64>>>,
    close: Option<Vec<Option<f64>>>,
    volume: Option<Vec<Option<i64>>>,
}

pub struct YahooFinanceClient {
    client: Client,
}

impl YahooFinanceClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Get latest quote for a symbol
    pub async fn get_quote(&self, symbol: &str) -> AppResult<MarketData> {
        let url = format!(
            "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=1d&range=1d",
            symbol
        );

        let response = self
            .client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0")
            .send()
            .await
            .map_err(|e| AppError::BrokerApi(format!("Yahoo Finance request failed: {}", e)))?;

        let data: YahooQuoteResponse = response
            .json()
            .await
            .map_err(|e| AppError::BrokerApi(format!("Yahoo Finance parse failed: {}", e)))?;

        if let Some(error) = data.chart.error {
            return Err(AppError::BrokerApi(format!(
                "Yahoo Finance error: {}",
                error.description
            )));
        }

        let result = data
            .chart
            .result
            .and_then(|mut r| r.pop())
            .ok_or_else(|| AppError::BrokerApi("No data from Yahoo Finance".to_string()))?;

        let price = result
            .meta
            .regular_market_price
            .ok_or_else(|| AppError::BrokerApi("No price data".to_string()))?;

        let previous_close = result.meta.previous_close;

        Ok(MarketData {
            symbol: result.meta.symbol,
            timestamp: Utc::now(),
            price: Decimal::from_str(&price.to_string())
                .map_err(|e| AppError::BrokerApi(format!("Price parse error: {}", e)))?,
            volume: 0, // Daily volume not in quick quote
            bid_price: None,
            ask_price: None,
            bid_size: None,
            ask_size: None,
            open_price: None,
            high_price: None,
            low_price: None,
            previous_close: previous_close.and_then(|p| Decimal::from_str(&p.to_string()).ok()),
            market_cap: None,
            pe_ratio: None,
            data_source: Some("Yahoo Finance".to_string()),
            exchange: None,
        })
    }

    /// Get historical bars
    pub async fn get_historical_bars(
        &self,
        symbol: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        interval: &str, // "1d", "1h", "5m", etc.
    ) -> AppResult<Vec<MarketData>> {
        let url = format!(
            "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval={}&period1={}&period2={}",
            symbol,
            interval,
            start.timestamp(),
            end.timestamp()
        );

        let response = self
            .client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0")
            .send()
            .await
            .map_err(|e| AppError::BrokerApi(format!("Yahoo Finance request failed: {}", e)))?;

        let data: YahooQuoteResponse = response
            .json()
            .await
            .map_err(|e| AppError::BrokerApi(format!("Yahoo Finance parse failed: {}", e)))?;

        if let Some(error) = data.chart.error {
            return Err(AppError::BrokerApi(format!(
                "Yahoo Finance error: {}",
                error.description
            )));
        }

        let result = data
            .chart
            .result
            .and_then(|mut r| r.pop())
            .ok_or_else(|| AppError::BrokerApi("No data from Yahoo Finance".to_string()))?;

        let timestamps = result
            .timestamp
            .ok_or_else(|| AppError::BrokerApi("No timestamps".to_string()))?;

        let quote = result
            .indicators
            .quote
            .into_iter()
            .next()
            .ok_or_else(|| AppError::BrokerApi("No quote data".to_string()))?;

        let opens = quote.open.unwrap_or_default();
        let highs = quote.high.unwrap_or_default();
        let lows = quote.low.unwrap_or_default();
        let closes = quote.close.unwrap_or_default();
        let volumes = quote.volume.unwrap_or_default();

        let mut bars = Vec::new();

        for (i, &ts) in timestamps.iter().enumerate() {
            let close = closes.get(i).and_then(|&c| c).unwrap_or(0.0);
            let volume = volumes.get(i).and_then(|&v| v).unwrap_or(0);

            let bar = MarketData {
                symbol: result.meta.symbol.clone(),
                timestamp: DateTime::from_timestamp(ts, 0)
                    .unwrap_or_else(Utc::now),
                price: Decimal::from_str(&close.to_string())
                    .unwrap_or(Decimal::ZERO),
                volume,
                bid_price: None,
                ask_price: None,
                bid_size: None,
                ask_size: None,
                open_price: opens
                    .get(i)
                    .and_then(|&o| o)
                    .and_then(|o: f64| Decimal::from_str(&o.to_string()).ok()),
                high_price: highs
                    .get(i)
                    .and_then(|&h| h)
                    .and_then(|h: f64| Decimal::from_str(&h.to_string()).ok()),
                low_price: lows
                    .get(i)
                    .and_then(|&l| l)
                    .and_then(|l: f64| Decimal::from_str(&l.to_string()).ok()),
                previous_close: result
                    .meta
                    .previous_close
                    .and_then(|p: f64| Decimal::from_str(&p.to_string()).ok()),
                market_cap: None,
                pe_ratio: None,
                data_source: Some("Yahoo Finance".to_string()),
                exchange: None,
            };

            bars.push(bar);
        }

        Ok(bars)
    }
}

impl Default for YahooFinanceClient {
    fn default() -> Self {
        Self::new()
    }
}
