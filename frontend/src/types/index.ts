// 市场数据类型
export interface MarketData {
  symbol: string;
  timestamp: string;
  price?: number;
  volume?: number;
  currency?: string;
  exchange?: string;
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
  data_source?: string;
}

export interface MarketDataMeta {
  status: 'live' | 'degraded' | 'error';
  source: string;
  fallback_used: boolean;
  is_stale: boolean;
  degraded: boolean;
  requested_symbol: string;
  normalized_symbol: string;
  interval?: string;
  message?: string | null;
}

export interface MarketQuoteResult {
  success: boolean;
  data: Partial<MarketData> | null;
  meta: MarketDataMeta;
  error?: string | null;
}

export interface MarketHistoryBar {
  timestamp: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  price?: number;
  volume?: number;
  data_source?: string;
  degraded?: boolean;
}

export interface MarketHistoryResult {
  success: boolean;
  data: MarketHistoryBar[];
  meta: MarketDataMeta;
  error?: string | null;
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
  stop_price?: number;
  order_type: OrderType;
  time_in_force?: string;
  extended_hours?: boolean;
  status: OrderStatus;
  strategy_id?: string;
  created_at: string;
  updated_at: string;
  filled_quantity: number;
  average_fill_price?: number;
}

export interface ExecutionTrade {
  id: number;
  order_id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  executed_at: string;
  portfolio_id?: string | null;
  strategy_id?: string | null;
}

export interface RiskCheckItem {
  rule_code: string;
  check_type: string;
  passed: boolean;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  actual_value?: string | null;
  threshold_value?: string | null;
}

export interface OrderRiskCheckResult {
  status: 'passed' | 'warning' | 'rejected';
  message?: string | null;
  checks: RiskCheckItem[];
}

export interface CreateOrderResult {
  accepted: boolean;
  order?: Order;
  order_preview?: Partial<Order>;
  risk_check?: OrderRiskCheckResult;
}

export interface PaperSimulationItem {
  order_id: string;
  symbol: string;
  status_before: string;
  status_after: string;
  action: 'filled' | 'partially_filled' | 'submitted' | 'unchanged' | 'unsupported';
  detail: string;
  market_price?: number | null;
  fill_price?: number | null;
}

export interface PaperSimulationResult {
  processed: number;
  filled: number;
  partially_filled: number;
  submitted: number;
  untouched: number;
  unsupported: number;
  results: PaperSimulationItem[];
}

export interface OrderAuditEntry {
  id: number;
  user_id?: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  details: Record<string, any>;
  created_at: string;
}

export interface OrderAuditTrail {
  order_id: string;
  entries: OrderAuditEntry[];
}

// 持仓类型
export interface Position {
  symbol: string;
  currency?: string;
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
  base_currency?: string;
  positions: Record<string, Position>;
  cash_balance: number;
  total_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  last_updated: string;
}

export interface PortfolioPnLPoint {
  date: string;
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
}

export interface PortfolioPnLReport {
  portfolio_id: string;
  date: string;
  total_value: number;
  cash_balance: number;
  unrealized_pnl: number;
  realized_pnl: number;
  generated_at: string;
}

// 策略配置类型
export interface StrategyConfig {
  id: string;
  name: string;
  display_name?: string;
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
  base_currency?: string;
  portfolio_value: number;
  total_exposure: number;
  leverage: number;
  var_1d?: number;
  max_drawdown?: number;
  sharpe_ratio?: number;
  calculated_at: string;
}

export interface RiskLimitsSnapshot {
  max_order_size: number;
  max_leverage: number;
  max_daily_loss?: number | null;
  max_portfolio_exposure?: number | null;
  max_single_stock_weight?: number | null;
  risk_check_enabled: boolean;
  paper_trading: boolean;
}

export interface RiskAlert {
  id: number;
  alert_type: string;
  message: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  created_at: string;
}

export interface BacktestDataGap {
  start: string;
  end: string;
  expected_interval_seconds: number;
  observed_interval_seconds: number;
  missing_bars_hint: number;
}

export interface BacktestDataQuality {
  source_label: string;
  local_data_hit: boolean;
  external_data_fallback: boolean;
  bar_count: number;
  minimum_required_bars: number;
  data_insufficient: boolean;
  missing_intervals: BacktestDataGap[];
  notes: string[];
}

export interface BacktestAssumptions {
  fee_bps: number;
  slippage_bps: number;
  max_position_fraction: number;
  rebalancing_logic: string;
  data_source: string;
}

export interface BacktestExecutionLink {
  status: string;
  reference_scope: string;
  explicit_link_id?: string | null;
  note: string;
}

export interface StrategyLatestBacktestSummary {
  source: string;
  run_id?: string | null;
  created_at?: string | null;
  strategy_id: string;
  strategy_name?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  experiment_label?: string | null;
  parameter_version?: string | null;
  total_return: number;
  annualized_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  total_trades: number;
  note: string;
}

export interface StrategyLatestRealTradeSummary {
  source: string;
  trade_id: number;
  order_id: string;
  executed_at: string;
  strategy_id?: string | null;
  portfolio_id?: string | null;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  note: string;
}

export interface StrategyRecentSignalSummary {
  source: string;
  status: string;
  confirmation_state: string;
  strategy_id: string;
  strategy_name?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  latest_signal_at?: string | null;
  signal_type?: SignalType | null;
  strength?: number | null;
  note: string;
}

export interface StrategySuggestedOrderDraft {
  symbol: string;
  side: OrderSide;
  quantity: number;
  strategy_id: string;
}

export interface StrategySignalSnapshot {
  strategy_id: string;
  strategy_name?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  signal_type?: SignalType | null;
  strength?: number | null;
  generated_at: string;
  source: string;
  confirmation_state: string;
  note: string;
  suggested_order?: StrategySuggestedOrderDraft | null;
}

export interface StrategyExecutionOverview {
  strategy_id: string;
  strategy_name?: string | null;
  latest_backtest?: StrategyLatestBacktestSummary | null;
  latest_real_trade?: StrategyLatestRealTradeSummary | null;
  recent_signal: StrategyRecentSignalSummary;
  generated_at: string;
}

// 回测结果类型
export interface BacktestResult {
  run_id?: string;
  experiment_id?: string | null;
  experiment_label?: string | null;
  experiment_note?: string | null;
  parameter_version?: string | null;
  strategy_id: string;
  strategy_name?: string;
  symbol?: string;
  timeframe?: string;
  parameters?: Record<string, any>;
  data_quality?: BacktestDataQuality | null;
  assumptions?: BacktestAssumptions | null;
  execution_link?: BacktestExecutionLink | null;
  trades?: BacktestTrade[];
  equity_curve?: BacktestEquityPoint[];
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
  created_at?: string;
}

export interface BacktestExperimentMetadata {
  experiment_label?: string | null;
  experiment_note?: string | null;
  parameter_version?: string | null;
}

export interface BacktestParameterSet {
  parameters: Record<string, any>;
}

export interface BacktestBatchResult {
  experiment_id?: string | null;
  count: number;
  results: BacktestResult[];
}

export interface BacktestListFilters {
  strategy_id?: string;
  symbol?: string;
  experiment_label?: string;
  parameter_version?: string;
  created_after?: string;
  created_before?: string;
  limit?: number;
}

export interface BacktestTrade {
  timestamp: string;
  side: string;
  quantity: number;
  signal_price: number;
  execution_price: number;
  fees: number;
  pnl?: number | null;
}

export interface BacktestEquityPoint {
  timestamp: string;
  equity: number;
  cash: number;
  position_quantity: number;
  market_price: number;
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
  deployed_at?: string | null;
  recent_error?: string | null;
  services: {
    database: string;
    redis: string;
    data_service: string;
    strategy_service: string;
    execution_service: string;
    portfolio_service: string;
    risk_service: string;
  };
  summary?: SystemHealthSummary | null;
}

export interface SystemHealthSummary {
  strategies_total: number;
  active_strategies: number;
  recent_orders: number;
  recent_backtests: number;
  recent_trades: number;
  deployed_at?: string | null;
  recent_error?: string | null;
  latest_strategy_at?: string | null;
  latest_order_at?: string | null;
  latest_backtest_at?: string | null;
  latest_trade_at?: string | null;
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

export interface ApiErrorBody {
  message: string;
  category: string;
  status: number;
  timestamp: string;
}

export interface ApiErrorResponse {
  error?: ApiErrorBody | null;
  message?: string | null;
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
