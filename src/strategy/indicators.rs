use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use std::collections::VecDeque;

/// Technical indicator calculations
/// All indicators return Option to handle insufficient data gracefully

/// Simple Moving Average (SMA)
pub fn sma(prices: &[Decimal], period: usize) -> Option<Decimal> {
    if prices.len() < period || period == 0 {
        return None;
    }
    let sum: Decimal = prices.iter().rev().take(period).sum();
    Some(sum / Decimal::from(period))
}

/// Exponential Moving Average (EMA)
pub fn ema(prices: &[Decimal], period: usize) -> Option<Decimal> {
    if prices.len() < period || period == 0 {
        return None;
    }

    let multiplier = Decimal::from(2) / Decimal::from(period + 1);

    // Start with SMA for first EMA value
    let initial_sma = sma(&prices[..period], period)?;

    let mut ema_value = initial_sma;
    for price in prices.iter().skip(period) {
        ema_value = (*price - ema_value) * multiplier + ema_value;
    }

    Some(ema_value)
}

/// Relative Strength Index (RSI)
#[derive(Debug, Clone)]
pub struct RSI {
    period: usize,
    gains: VecDeque<Decimal>,
    losses: VecDeque<Decimal>,
    prev_price: Option<Decimal>,
    avg_gain: Option<Decimal>,
    avg_loss: Option<Decimal>,
}

impl RSI {
    pub fn new(period: usize) -> Self {
        Self {
            period,
            gains: VecDeque::with_capacity(period),
            losses: VecDeque::with_capacity(period),
            prev_price: None,
            avg_gain: None,
            avg_loss: None,
        }
    }

    pub fn update(&mut self, price: Decimal) -> Option<Decimal> {
        if let Some(prev) = self.prev_price {
            let change = price - prev;
            let gain = if change > Decimal::ZERO {
                change
            } else {
                Decimal::ZERO
            };
            let loss = if change < Decimal::ZERO {
                change.abs()
            } else {
                Decimal::ZERO
            };

            self.gains.push_back(gain);
            self.losses.push_back(loss);

            if self.gains.len() > self.period {
                self.gains.pop_front();
                self.losses.pop_front();
            }

            if self.gains.len() == self.period {
                let avg_gain: Decimal =
                    self.gains.iter().sum::<Decimal>() / Decimal::from(self.period);
                let avg_loss: Decimal =
                    self.losses.iter().sum::<Decimal>() / Decimal::from(self.period);

                self.avg_gain = Some(avg_gain);
                self.avg_loss = Some(avg_loss);

                if avg_loss == Decimal::ZERO {
                    self.prev_price = Some(price);
                    return Some(Decimal::from(100));
                }

                let rs = avg_gain / avg_loss;
                let rsi = Decimal::from(100) - (Decimal::from(100) / (Decimal::ONE + rs));
                self.prev_price = Some(price);
                return Some(rsi);
            }
        }
        self.prev_price = Some(price);
        None
    }

    /// Calculate RSI from a price series
    pub fn calculate(prices: &[Decimal], period: usize) -> Option<Decimal> {
        let mut rsi = RSI::new(period);
        let mut result = None;
        for price in prices {
            result = rsi.update(*price);
        }
        result
    }
}

/// MACD (Moving Average Convergence Divergence)
#[derive(Debug, Clone)]
pub struct MACD {
    fast_period: usize,
    slow_period: usize,
    signal_period: usize,
}

#[derive(Debug, Clone)]
pub struct MACDResult {
    pub macd_line: Decimal,
    pub signal_line: Decimal,
    pub histogram: Decimal,
}

impl MACD {
    pub fn new(fast_period: usize, slow_period: usize, signal_period: usize) -> Self {
        Self {
            fast_period,
            slow_period,
            signal_period,
        }
    }

    pub fn calculate(&self, prices: &[Decimal]) -> Option<MACDResult> {
        if prices.len() < self.slow_period + self.signal_period {
            return None;
        }

        let fast_ema = ema(prices, self.fast_period)?;
        let slow_ema = ema(prices, self.slow_period)?;
        let macd_line = fast_ema - slow_ema;

        // Calculate MACD line history for signal line
        let mut macd_history = Vec::new();
        for i in self.slow_period..=prices.len() {
            let fast = ema(&prices[..i], self.fast_period)?;
            let slow = ema(&prices[..i], self.slow_period)?;
            macd_history.push(fast - slow);
        }

        let signal_line = ema(&macd_history, self.signal_period)?;
        let histogram = macd_line - signal_line;

        Some(MACDResult {
            macd_line,
            signal_line,
            histogram,
        })
    }
}

/// Bollinger Bands
#[derive(Debug, Clone)]
pub struct BollingerBands {
    period: usize,
    std_dev_multiplier: Decimal,
}

#[derive(Debug, Clone)]
pub struct BollingerBandsResult {
    pub upper_band: Decimal,
    pub middle_band: Decimal,
    pub lower_band: Decimal,
    pub bandwidth: Decimal,
    pub percent_b: Decimal,
}

impl BollingerBands {
    pub fn new(period: usize, std_dev_multiplier: f64) -> Self {
        Self {
            period,
            std_dev_multiplier: Decimal::from_f64(std_dev_multiplier).unwrap_or(Decimal::from(2)),
        }
    }

    pub fn calculate(&self, prices: &[Decimal]) -> Option<BollingerBandsResult> {
        if prices.len() < self.period {
            return None;
        }

        let middle_band = sma(prices, self.period)?;

        // Calculate standard deviation
        let recent_prices: Vec<_> = prices.iter().rev().take(self.period).cloned().collect();
        let variance: Decimal = recent_prices
            .iter()
            .map(|p| (*p - middle_band).powi(2))
            .sum::<Decimal>()
            / Decimal::from(self.period);

        let std_dev = variance.sqrt().unwrap_or(Decimal::ZERO);
        let band_width = self.std_dev_multiplier * std_dev;

        let upper_band = middle_band + band_width;
        let lower_band = middle_band - band_width;

        let current_price = *prices.last()?;
        let bandwidth = if middle_band != Decimal::ZERO {
            (upper_band - lower_band) / middle_band
        } else {
            Decimal::ZERO
        };

        let percent_b = if upper_band != lower_band {
            (current_price - lower_band) / (upper_band - lower_band)
        } else {
            Decimal::new(5, 1) // 0.5
        };

        Some(BollingerBandsResult {
            upper_band,
            middle_band,
            lower_band,
            bandwidth,
            percent_b,
        })
    }
}

/// Average True Range (ATR) for volatility measurement
pub struct ATR {
    period: usize,
}

impl ATR {
    pub fn new(period: usize) -> Self {
        Self { period }
    }

    /// Calculate ATR from OHLC data
    /// Each tuple is (high, low, close)
    pub fn calculate(&self, ohlc: &[(Decimal, Decimal, Decimal)]) -> Option<Decimal> {
        if ohlc.len() < self.period + 1 {
            return None;
        }

        let mut true_ranges = Vec::new();

        for i in 1..ohlc.len() {
            let (high, low, _) = ohlc[i];
            let (_, _, prev_close) = ohlc[i - 1];

            let tr1 = high - low;
            let tr2 = (high - prev_close).abs();
            let tr3 = (low - prev_close).abs();

            let true_range = tr1.max(tr2).max(tr3);
            true_ranges.push(true_range);
        }

        sma(&true_ranges, self.period)
    }
}

/// Stochastic Oscillator
#[derive(Debug, Clone)]
pub struct Stochastic {
    k_period: usize,
    d_period: usize,
}

#[derive(Debug, Clone)]
pub struct StochasticResult {
    pub k: Decimal,
    pub d: Decimal,
}

impl Stochastic {
    pub fn new(k_period: usize, d_period: usize) -> Self {
        Self { k_period, d_period }
    }

    /// Calculate from high, low, close data
    pub fn calculate(
        &self,
        highs: &[Decimal],
        lows: &[Decimal],
        closes: &[Decimal],
    ) -> Option<StochasticResult> {
        if highs.len() < self.k_period || lows.len() < self.k_period || closes.len() < self.k_period
        {
            return None;
        }

        let mut k_values = Vec::new();

        for i in (self.k_period - 1)..closes.len() {
            let start = i + 1 - self.k_period;
            let highest_high = highs[start..=i].iter().max()?.clone();
            let lowest_low = lows[start..=i].iter().min()?.clone();

            let k = if highest_high != lowest_low {
                (closes[i] - lowest_low) / (highest_high - lowest_low) * Decimal::from(100)
            } else {
                Decimal::from(50)
            };
            k_values.push(k);
        }

        let current_k = *k_values.last()?;
        let d = sma(&k_values, self.d_period)?;

        Some(StochasticResult { k: current_k, d })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(v: &str) -> Decimal {
        Decimal::from_str(v).unwrap()
    }

    #[test]
    fn test_sma() {
        let prices = vec![dec("10"), dec("11"), dec("12"), dec("13"), dec("14")];
        assert_eq!(sma(&prices, 3), Some(dec("13"))); // (12+13+14)/3 = 13
        assert_eq!(sma(&prices, 5), Some(dec("12"))); // (10+11+12+13+14)/5 = 12
        assert_eq!(sma(&prices, 6), None); // Not enough data
    }

    #[test]
    fn test_rsi() {
        let prices: Vec<Decimal> = vec![
            dec("44"),
            dec("44.25"),
            dec("44.5"),
            dec("43.75"),
            dec("44.5"),
            dec("44.25"),
            dec("44.125"),
            dec("43.75"),
            dec("44.5"),
            dec("44.25"),
            dec("44.5"),
            dec("45"),
            dec("45.5"),
            dec("46"),
            dec("45.5"),
        ];

        let rsi = RSI::calculate(&prices, 14);
        assert!(rsi.is_some());
        let rsi_val = rsi.unwrap();
        // RSI should be between 0 and 100
        assert!(rsi_val >= Decimal::ZERO && rsi_val <= Decimal::from(100));
    }

    #[test]
    fn test_bollinger_bands() {
        let prices: Vec<Decimal> = (1..=20).map(|i| Decimal::from(100 + i)).collect();
        let bb = BollingerBands::new(20, 2.0);
        let result = bb.calculate(&prices);

        assert!(result.is_some());
        let bands = result.unwrap();
        assert!(bands.upper_band > bands.middle_band);
        assert!(bands.middle_band > bands.lower_band);
    }
}
