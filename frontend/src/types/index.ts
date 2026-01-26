// 市场数据类型
export interface MarketData {
  symbol: string;
  timestamp: string;
  price: number;
  volume: number;
  change?: number;
  change_percent?: number;
  previous_close?: number;
  open?: number;
  high?: number;
  low?: number;
  bid_price?: number;
  ask_price?: number;
  bid_size?: number;
  ask_size?: number;
}

// 交易信号类型
export type SignalType = 'Buy' | 'Sell' | 'Hold';

export interface Signal {
  id: string;
  strategy_id: string;
  symbol: string;
  signal_type: SignalType;
  strength: number;
  timestamp: string;
  metadata: Record<string, any>;
}

// 订单类型
export type OrderSide = 'Buy' | 'Sell';
export type OrderType = 'Market' | 'Limit' | 'Stop' | 'StopLimit';
export type OrderStatus = 'Pending' | 'Submitted' | 'PartiallyFilled' | 'Filled' | 'Cancelled' | 'Rejected';

export interface CreateOrderPayload {
  symbol: string;
  side: OrderSide;
  quantity: number;
  price?: number;
  order_type: OrderType;
  strategy_id?: string;
  // 高级订单字段
  time_in_force?: string;
  stop_price?: number;
  extended_hours?: boolean;
}

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price?: number;
  order_type: OrderType;
  status: OrderStatus;
  strategy_id?: string;
  created_at: string;
  updated_at: string;
  filled_quantity: number;
  average_fill_price?: number;
}

// 持仓类型
export interface Position {
  symbol: string;
  quantity: number;
  average_cost: number;
  market_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  last_updated: string;
}

// 组合类型
export interface Portfolio {
  id: string;
  name: string;
  positions: Record<string, Position>;
  cash_balance: number;
  total_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  last_updated: string;
}

// 策略配置类型
export interface StrategyConfig {
  id: string;
  name: string;
  description?: string;
  parameters: Record<string, any>;
  risk_limits: RiskLimits;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RiskLimits {
  max_position_size?: number;
  max_daily_loss?: number;
  max_portfolio_exposure?: number;
  max_single_stock_weight?: number;
}

// 风险指标类型
export interface RiskMetrics {
  portfolio_value: number;
  total_exposure: number;
  leverage: number;
  var_1d?: number;
  max_drawdown?: number;
  sharpe_ratio?: number;
  calculated_at: string;
}

// 回测结果类型
export interface BacktestResult {
  strategy_id: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  final_capital: number;
  total_return: number;
  annualized_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  total_trades: number;
  performance_metrics: PerformanceMetrics;
}

export interface PerformanceMetrics {
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  gross_profit: number;
  gross_loss: number;
  profit_factor: number;
  average_win: number;
  average_loss: number;
  largest_win: number;
  largest_loss: number;
}

// 系统状态类型
export interface SystemHealth {
  status: 'healthy' | 'warning' | 'error';
  timestamp: string;
  services: {
    database: string;
    redis: string;
    data_service: string;
    strategy_service: string;
    execution_service: string;
    portfolio_service: string;
    risk_service: string;
  };
}

// API响应类型
export interface ApiResponse<T> {
  data?: T;
  error?: {
    message: string;
    category: string;
    status: number;
    timestamp: string;
  };
}

// 图表数据类型
export interface ChartDataPoint {
  timestamp: string;
  value: number;
  volume?: number;
}

export interface CandlestickData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 交易统计类型
export interface TradingStats {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  average_win: number;
  average_loss: number;
  profit_factor: number;
  max_drawdown: number;
  sharpe_ratio: number;
}