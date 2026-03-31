# Product: HK-US Quant Trading Platform

A full-stack quantitative trading platform targeting Hong Kong (HKEX) and US (NYSE/NASDAQ) equity markets. The system supports real-time market data, strategy execution, backtesting, portfolio management, and risk monitoring.

## Core Capabilities

- **Market Data**: Real-time quotes and historical OHLCV data via Yahoo Finance (US) and Python scripts (HK). Symbols normalized to `XXXX.HK` for HK stocks and plain tickers for US stocks.
- **Strategy Engine**: SMA, EMA, RSI, MACD, Bollinger Bands, dual moving average crossover strategies with configurable parameters and risk limits.
- **Order Management**: Market, Limit, Stop, StopLimit orders with time-in-force, extended hours, and paper trading simulation.
- **Portfolio & Risk**: Position tracking, P&L history, VaR, Sharpe/Sortino/Calmar ratios, drawdown, and configurable risk alerts.
- **Backtesting**: Historical strategy simulation with full equity curve, trade log, and performance metrics.
- **Real-time Push**: WebSocket (`/ws`) broadcasts `MarketData`, `Signal`, `OrderUpdate`, `PortfolioUpdate` messages.

## Market Data Status Model

API responses carry a `meta.status` field: `live` | `degraded` | `error`. The frontend must display this status explicitly — never silently present degraded data as live.

## Current State

The platform is a working prototype (v0.1.0). Paper trading is enabled by default (`PAPER_TRADING=true`). Live broker integration (Alpaca) is partially implemented. User authentication is not yet implemented.
