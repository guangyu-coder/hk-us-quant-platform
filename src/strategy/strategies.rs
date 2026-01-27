use super::indicators::{BollingerBands, MACD, RSI};
use super::Strategy;
use crate::error::AppResult;
use crate::types::{MarketData, Signal, SignalType, StrategyConfig};
use async_trait::async_trait;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::sync::RwLock;
use tracing::debug;

/// RSI (Relative Strength Index) Strategy
/// - Buy when RSI crosses below oversold threshold (e.g., 30)
/// - Sell when RSI crosses above overbought threshold (e.g., 70)
pub struct RSIStrategy {
    config: StrategyConfig,
    period: usize,
    oversold: Decimal,
    overbought: Decimal,
    price_history: RwLock<HashMap<String, Vec<Decimal>>>,
}

impl RSIStrategy {
    pub fn new(config: StrategyConfig) -> AppResult<Self> {
        let period = config
            .parameters
            .get("period")
            .and_then(|v| v.as_u64())
            .unwrap_or(14) as usize;

        let oversold = config
            .parameters
            .get("oversold")
            .and_then(|v| v.as_f64())
            .map(|v| Decimal::from_f64(v).unwrap_or(Decimal::from(30)))
            .unwrap_or(Decimal::from(30));

        let overbought = config
            .parameters
            .get("overbought")
            .and_then(|v| v.as_f64())
            .map(|v| Decimal::from_f64(v).unwrap_or(Decimal::from(70)))
            .unwrap_or(Decimal::from(70));

        Ok(Self {
            config,
            period,
            oversold,
            overbought,
            price_history: RwLock::new(HashMap::new()),
        })
    }
}

#[async_trait]
impl Strategy for RSIStrategy {
    async fn generate_signals(&self, market_data: &MarketData) -> AppResult<Vec<Signal>> {
        let mut signals = Vec::new();
        let symbol = &market_data.symbol;
        let price = market_data.price;

        // Update price history
        {
            let mut history = self.price_history.write().unwrap();
            let prices = history.entry(symbol.clone()).or_insert_with(Vec::new);
            prices.push(price);
            
            // Keep only necessary history
            if prices.len() > self.period * 2 {
                prices.drain(0..prices.len() - self.period * 2);
            }
        }

        // Calculate RSI
        let history = self.price_history.read().unwrap();
        if let Some(prices) = history.get(symbol) {
            if let Some(rsi) = RSI::calculate(prices, self.period) {
                debug!("RSI for {}: {}", symbol, rsi);

                let (signal_type, strength) = if rsi < self.oversold {
                    // Oversold - potential buy signal
                    let strength = ((self.oversold - rsi) / self.oversold)
                        .to_f64()
                        .unwrap_or(0.5)
                        .min(1.0);
                    (SignalType::Buy, strength)
                } else if rsi > self.overbought {
                    // Overbought - potential sell signal
                    let strength = ((rsi - self.overbought) / (Decimal::from(100) - self.overbought))
                        .to_f64()
                        .unwrap_or(0.5)
                        .min(1.0);
                    (SignalType::Sell, strength)
                } else {
                    (SignalType::Hold, 0.0)
                };

                if signal_type != SignalType::Hold {
                    signals.push(Signal::new(
                        self.config.id.clone(),
                        symbol.clone(),
                        signal_type,
                        strength,
                    ));
                }
            }
        }

        Ok(signals)
    }

    async fn update_parameters(
        &mut self,
        params: HashMap<String, serde_json::Value>,
    ) -> AppResult<()> {
        if let Some(period) = params.get("period").and_then(|v| v.as_u64()) {
            self.period = period as usize;
        }
        if let Some(oversold) = params.get("oversold").and_then(|v| v.as_f64()) {
            self.oversold = Decimal::from_f64(oversold).unwrap_or(self.oversold);
        }
        if let Some(overbought) = params.get("overbought").and_then(|v| v.as_f64()) {
            self.overbought = Decimal::from_f64(overbought).unwrap_or(self.overbought);
        }
        Ok(())
    }

    fn get_name(&self) -> &str {
        &self.config.name
    }

    fn get_description(&self) -> &str {
        self.config
            .description
            .as_deref()
            .unwrap_or("RSI Strategy: Buy on oversold, sell on overbought")
    }
}

/// MACD (Moving Average Convergence Divergence) Strategy
/// - Buy when MACD crosses above signal line (bullish crossover)
/// - Sell when MACD crosses below signal line (bearish crossover)
pub struct MACDStrategy {
    config: StrategyConfig,
    fast_period: usize,
    slow_period: usize,
    signal_period: usize,
    price_history: RwLock<HashMap<String, Vec<Decimal>>>,
    prev_histogram: RwLock<HashMap<String, Decimal>>,
}

impl MACDStrategy {
    pub fn new(config: StrategyConfig) -> AppResult<Self> {
        let fast_period = config
            .parameters
            .get("fast_period")
            .and_then(|v| v.as_u64())
            .unwrap_or(12) as usize;

        let slow_period = config
            .parameters
            .get("slow_period")
            .and_then(|v| v.as_u64())
            .unwrap_or(26) as usize;

        let signal_period = config
            .parameters
            .get("signal_period")
            .and_then(|v| v.as_u64())
            .unwrap_or(9) as usize;

        Ok(Self {
            config,
            fast_period,
            slow_period,
            signal_period,
            price_history: RwLock::new(HashMap::new()),
            prev_histogram: RwLock::new(HashMap::new()),
        })
    }
}

#[async_trait]
impl Strategy for MACDStrategy {
    async fn generate_signals(&self, market_data: &MarketData) -> AppResult<Vec<Signal>> {
        let mut signals = Vec::new();
        let symbol = &market_data.symbol;
        let price = market_data.price;

        // Update price history
        {
            let mut history = self.price_history.write().unwrap();
            let prices = history.entry(symbol.clone()).or_insert_with(Vec::new);
            prices.push(price);

            // Keep enough history for MACD calculation
            let max_history = (self.slow_period + self.signal_period) * 2;
            if prices.len() > max_history {
                prices.drain(0..prices.len() - max_history);
            }
        }

        // Calculate MACD
        let history = self.price_history.read().unwrap();
        if let Some(prices) = history.get(symbol) {
            let macd = MACD::new(self.fast_period, self.slow_period, self.signal_period);
            if let Some(result) = macd.calculate(prices) {
                let mut prev_hist = self.prev_histogram.write().unwrap();
                let prev = prev_hist.get(symbol).cloned();

                debug!(
                    "MACD for {}: line={}, signal={}, histogram={}",
                    symbol, result.macd_line, result.signal_line, result.histogram
                );

                // Detect crossovers
                if let Some(prev_histogram) = prev {
                    let (signal_type, strength) = if prev_histogram <= Decimal::ZERO
                        && result.histogram > Decimal::ZERO
                    {
                        // Bullish crossover
                        let strength = result.histogram.abs().to_f64().unwrap_or(0.5).min(1.0);
                        (SignalType::Buy, strength)
                    } else if prev_histogram >= Decimal::ZERO && result.histogram < Decimal::ZERO {
                        // Bearish crossover
                        let strength = result.histogram.abs().to_f64().unwrap_or(0.5).min(1.0);
                        (SignalType::Sell, strength)
                    } else {
                        (SignalType::Hold, 0.0)
                    };

                    if signal_type != SignalType::Hold {
                        signals.push(Signal::new(
                            self.config.id.clone(),
                            symbol.clone(),
                            signal_type,
                            strength,
                        ));
                    }
                }

                prev_hist.insert(symbol.clone(), result.histogram);
            }
        }

        Ok(signals)
    }

    async fn update_parameters(
        &mut self,
        params: HashMap<String, serde_json::Value>,
    ) -> AppResult<()> {
        if let Some(v) = params.get("fast_period").and_then(|v| v.as_u64()) {
            self.fast_period = v as usize;
        }
        if let Some(v) = params.get("slow_period").and_then(|v| v.as_u64()) {
            self.slow_period = v as usize;
        }
        if let Some(v) = params.get("signal_period").and_then(|v| v.as_u64()) {
            self.signal_period = v as usize;
        }
        Ok(())
    }

    fn get_name(&self) -> &str {
        &self.config.name
    }

    fn get_description(&self) -> &str {
        self.config
            .description
            .as_deref()
            .unwrap_or("MACD Strategy: Trade on MACD/Signal line crossovers")
    }
}

/// Bollinger Bands Strategy
/// - Buy when price touches or crosses below lower band (oversold)
/// - Sell when price touches or crosses above upper band (overbought)
pub struct BollingerBandsStrategy {
    config: StrategyConfig,
    period: usize,
    std_dev: f64,
    price_history: RwLock<HashMap<String, Vec<Decimal>>>,
}

impl BollingerBandsStrategy {
    pub fn new(config: StrategyConfig) -> AppResult<Self> {
        let period = config
            .parameters
            .get("period")
            .and_then(|v| v.as_u64())
            .unwrap_or(20) as usize;

        let std_dev = config
            .parameters
            .get("std_dev")
            .and_then(|v| v.as_f64())
            .unwrap_or(2.0);

        Ok(Self {
            config,
            period,
            std_dev,
            price_history: RwLock::new(HashMap::new()),
        })
    }
}

#[async_trait]
impl Strategy for BollingerBandsStrategy {
    async fn generate_signals(&self, market_data: &MarketData) -> AppResult<Vec<Signal>> {
        let mut signals = Vec::new();
        let symbol = &market_data.symbol;
        let price = market_data.price;

        // Update price history
        {
            let mut history = self.price_history.write().unwrap();
            let prices = history.entry(symbol.clone()).or_insert_with(Vec::new);
            prices.push(price);

            if prices.len() > self.period * 2 {
                prices.drain(0..prices.len() - self.period * 2);
            }
        }

        // Calculate Bollinger Bands
        let history = self.price_history.read().unwrap();
        if let Some(prices) = history.get(symbol) {
            let bb = BollingerBands::new(self.period, self.std_dev);
            if let Some(result) = bb.calculate(prices) {
                debug!(
                    "BB for {}: upper={}, middle={}, lower={}, %B={}",
                    symbol, result.upper_band, result.middle_band, result.lower_band, result.percent_b
                );

                let (signal_type, strength) = if price <= result.lower_band {
                    // Price at or below lower band - oversold
                    let strength = (Decimal::ONE - result.percent_b)
                        .to_f64()
                        .unwrap_or(0.5)
                        .abs()
                        .min(1.0);
                    (SignalType::Buy, strength)
                } else if price >= result.upper_band {
                    // Price at or above upper band - overbought
                    let strength = (result.percent_b - Decimal::ONE)
                        .to_f64()
                        .unwrap_or(0.5)
                        .abs()
                        .min(1.0);
                    (SignalType::Sell, strength)
                } else {
                    (SignalType::Hold, 0.0)
                };

                if signal_type != SignalType::Hold {
                    signals.push(Signal::new(
                        self.config.id.clone(),
                        symbol.clone(),
                        signal_type,
                        strength,
                    ));
                }
            }
        }

        Ok(signals)
    }

    async fn update_parameters(
        &mut self,
        params: HashMap<String, serde_json::Value>,
    ) -> AppResult<()> {
        if let Some(v) = params.get("period").and_then(|v| v.as_u64()) {
            self.period = v as usize;
        }
        if let Some(v) = params.get("std_dev").and_then(|v| v.as_f64()) {
            self.std_dev = v;
        }
        Ok(())
    }

    fn get_name(&self) -> &str {
        &self.config.name
    }

    fn get_description(&self) -> &str {
        self.config
            .description
            .as_deref()
            .unwrap_or("Bollinger Bands Strategy: Trade on band touches")
    }
}

/// Dual Moving Average Crossover Strategy
/// - Buy when fast MA crosses above slow MA (golden cross)
/// - Sell when fast MA crosses below slow MA (death cross)
pub struct DualMACrossoverStrategy {
    config: StrategyConfig,
    fast_period: usize,
    slow_period: usize,
    price_history: RwLock<HashMap<String, Vec<Decimal>>>,
    prev_position: RwLock<HashMap<String, i8>>, // 1 = above, -1 = below, 0 = unknown
}

impl DualMACrossoverStrategy {
    pub fn new(config: StrategyConfig) -> AppResult<Self> {
        let fast_period = config
            .parameters
            .get("fast_period")
            .and_then(|v| v.as_u64())
            .unwrap_or(10) as usize;

        let slow_period = config
            .parameters
            .get("slow_period")
            .and_then(|v| v.as_u64())
            .unwrap_or(30) as usize;

        Ok(Self {
            config,
            fast_period,
            slow_period,
            price_history: RwLock::new(HashMap::new()),
            prev_position: RwLock::new(HashMap::new()),
        })
    }
}

#[async_trait]
impl Strategy for DualMACrossoverStrategy {
    async fn generate_signals(&self, market_data: &MarketData) -> AppResult<Vec<Signal>> {
        use super::indicators::sma;
        
        let mut signals = Vec::new();
        let symbol = &market_data.symbol;
        let price = market_data.price;

        // Update price history
        {
            let mut history = self.price_history.write().unwrap();
            let prices = history.entry(symbol.clone()).or_insert_with(Vec::new);
            prices.push(price);

            if prices.len() > self.slow_period * 2 {
                prices.drain(0..prices.len() - self.slow_period * 2);
            }
        }

        // Calculate MAs and detect crossover
        let history = self.price_history.read().unwrap();
        if let Some(prices) = history.get(symbol) {
            if let (Some(fast_ma), Some(slow_ma)) = (
                sma(prices, self.fast_period),
                sma(prices, self.slow_period),
            ) {
                let current_position: i8 = if fast_ma > slow_ma { 1 } else { -1 };
                
                let mut prev_pos = self.prev_position.write().unwrap();
                let prev = prev_pos.get(symbol).cloned().unwrap_or(0);

                debug!(
                    "MA for {}: fast={}, slow={}, prev_pos={}, curr_pos={}",
                    symbol, fast_ma, slow_ma, prev, current_position
                );

                if prev != 0 && prev != current_position {
                    let (signal_type, strength) = if current_position == 1 {
                        // Golden cross - bullish
                        let gap = (fast_ma - slow_ma) / slow_ma;
                        (SignalType::Buy, gap.to_f64().unwrap_or(0.5).abs().min(1.0))
                    } else {
                        // Death cross - bearish
                        let gap = (slow_ma - fast_ma) / slow_ma;
                        (SignalType::Sell, gap.to_f64().unwrap_or(0.5).abs().min(1.0))
                    };

                    signals.push(Signal::new(
                        self.config.id.clone(),
                        symbol.clone(),
                        signal_type,
                        strength,
                    ));
                }

                prev_pos.insert(symbol.clone(), current_position);
            }
        }

        Ok(signals)
    }

    async fn update_parameters(
        &mut self,
        params: HashMap<String, serde_json::Value>,
    ) -> AppResult<()> {
        if let Some(v) = params.get("fast_period").and_then(|v| v.as_u64()) {
            self.fast_period = v as usize;
        }
        if let Some(v) = params.get("slow_period").and_then(|v| v.as_u64()) {
            self.slow_period = v as usize;
        }
        Ok(())
    }

    fn get_name(&self) -> &str {
        &self.config.name
    }

    fn get_description(&self) -> &str {
        self.config
            .description
            .as_deref()
            .unwrap_or("Dual MA Crossover: Trade on golden/death crosses")
    }
}

/// Pairs Trading Strategy
/// - Monitors the price ratio between two correlated assets (Asset A / Asset B)
/// - Calculates the Z-score of the ratio (deviation from mean)
/// - Buy A / Sell B when ratio is too low (Z-score < -threshold)
/// - Sell A / Buy B when ratio is too high (Z-score > threshold)
/// - Close positions when ratio returns to mean
pub struct PairsTradingStrategy {
    config: StrategyConfig,
    asset_a: String,
    asset_b: String,
    lookback_period: usize,
    threshold: f64,
    price_history_a: RwLock<Vec<Decimal>>,
    price_history_b: RwLock<Vec<Decimal>>,
}

impl PairsTradingStrategy {
    pub fn new(config: StrategyConfig) -> AppResult<Self> {
        let asset_a = config
            .parameters
            .get("asset_a")
            .and_then(|v| v.as_str())
            .ok_or_else(|| crate::error::AppError::strategy("Missing parameter: asset_a"))?
            .to_string();

        let asset_b = config
            .parameters
            .get("asset_b")
            .and_then(|v| v.as_str())
            .ok_or_else(|| crate::error::AppError::strategy("Missing parameter: asset_b"))?
            .to_string();

        let lookback_period = config
            .parameters
            .get("lookback_period")
            .and_then(|v| v.as_u64())
            .unwrap_or(20) as usize;

        let threshold = config
            .parameters
            .get("threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(2.0);

        Ok(Self {
            config,
            asset_a,
            asset_b,
            lookback_period,
            threshold,
            price_history_a: RwLock::new(Vec::new()),
            price_history_b: RwLock::new(Vec::new()),
        })
    }
}

#[async_trait]
impl Strategy for PairsTradingStrategy {
    async fn generate_signals(&self, market_data: &MarketData) -> AppResult<Vec<Signal>> {
        let symbol = &market_data.symbol;
        let price = market_data.price;
        let mut signals = Vec::new();

        // Only process if it's one of our pair assets
        if symbol != &self.asset_a && symbol != &self.asset_b {
            return Ok(signals);
        }

        // Update history
        {
            let mut history = if symbol == &self.asset_a {
                self.price_history_a.write().unwrap()
            } else {
                self.price_history_b.write().unwrap()
            };
            history.push(price);
            if history.len() > self.lookback_period {
                history.remove(0);
            }
        }

        // Check if we have enough data for both assets
        let history_a = self.price_history_a.read().unwrap();
        let history_b = self.price_history_b.read().unwrap();

        if history_a.len() < self.lookback_period || history_b.len() < self.lookback_period {
            return Ok(signals);
        }

        // Calculate ratios and Z-score
        let mut ratios = Vec::with_capacity(self.lookback_period);
        for i in 0..self.lookback_period {
            let price_a = history_a[i];
            let price_b = history_b[i];
            if !price_b.is_zero() {
                ratios.push(price_a / price_b);
            }
        }

        if ratios.len() < self.lookback_period {
            return Ok(signals);
        }

        let current_ratio = *ratios.last().unwrap();
        let sum: Decimal = ratios.iter().sum();
        let mean = sum / Decimal::from(ratios.len());

        let variance: Decimal = ratios
            .iter()
            .map(|value| {
                let diff = value - mean;
                diff * diff
            })
            .sum::<Decimal>()
            / Decimal::from(ratios.len());
        
        let std_dev = variance.sqrt().unwrap_or(Decimal::ONE);
        
        if std_dev.is_zero() {
             return Ok(signals);
        }

        let z_score = (current_ratio - mean) / std_dev;
        let z_val = z_score.to_f64().unwrap_or(0.0);

        debug!("Pairs Trading {}-{}: Ratio={}, Mean={}, Z-Score={}", 
               self.asset_a, self.asset_b, current_ratio, mean, z_val);

        // Generate signals based on Z-score
        if z_val > self.threshold {
            // Ratio is too high: Short A, Long B
            signals.push(Signal::new(
                self.config.id.clone(),
                self.asset_a.clone(),
                SignalType::Sell,
                1.0,
            ));
            signals.push(Signal::new(
                self.config.id.clone(),
                self.asset_b.clone(),
                SignalType::Buy,
                1.0,
            ));
        } else if z_val < -self.threshold {
            // Ratio is too low: Long A, Short B
            signals.push(Signal::new(
                self.config.id.clone(),
                self.asset_a.clone(),
                SignalType::Buy,
                1.0,
            ));
            signals.push(Signal::new(
                self.config.id.clone(),
                self.asset_b.clone(),
                SignalType::Sell,
                1.0,
            ));
        } else if z_val.abs() < 0.5 {
             // Close positions when ratio returns to mean (optional implementation)
             // For now, we just emit 'Hold' or nothing
        }

        Ok(signals)
    }

    async fn update_parameters(
        &mut self,
        params: HashMap<String, serde_json::Value>,
    ) -> AppResult<()> {
        if let Some(v) = params.get("threshold").and_then(|v| v.as_f64()) {
            self.threshold = v;
        }
        Ok(())
    }

    fn get_name(&self) -> &str {
        &self.config.name
    }

    fn get_description(&self) -> &str {
        self.config
            .description
            .as_deref()
            .unwrap_or("Pairs Trading Strategy: Statistical arbitrage on asset correlation")
    }
}
