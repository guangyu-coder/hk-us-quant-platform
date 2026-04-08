import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMocks = vi.hoisted(() => ({
  getStrategies: vi.fn(),
  createStrategy: vi.fn(),
  updateStrategy: vi.fn(),
  deleteStrategy: vi.fn(),
  runBacktest: vi.fn(),
  runBacktestBatch: vi.fn(),
  listBacktestsWithFilters: vi.fn(),
  getStrategyState: vi.fn(),
  listLatestSignals: vi.fn(),
  refreshStrategySignal: vi.fn(),
  listSignalReviews: vi.fn(),
  confirmSignalReview: vi.fn(),
  ignoreSignalReview: vi.fn(),
  updateSignalReviewNote: vi.fn(),
  getOrders: vi.fn(),
  createOrder: vi.fn(),
  cancelOrder: vi.fn(),
  getOrderStatus: vi.fn(),
  getOrderAudit: vi.fn(),
  simulateOrders: vi.fn(),
  listTrades: vi.fn(),
  searchSymbols: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getApiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  strategyApi: {
    getStrategies: apiMocks.getStrategies,
    createStrategy: apiMocks.createStrategy,
    updateStrategy: apiMocks.updateStrategy,
    deleteStrategy: apiMocks.deleteStrategy,
    runBacktest: apiMocks.runBacktest,
    runBacktestBatch: apiMocks.runBacktestBatch,
    listBacktestsWithFilters: apiMocks.listBacktestsWithFilters,
    getStrategyState: apiMocks.getStrategyState,
  },
  signalApi: {
    listLatestSignals: apiMocks.listLatestSignals,
    refreshStrategySignal: apiMocks.refreshStrategySignal,
    listSignalReviews: apiMocks.listSignalReviews,
    confirmSignalReview: apiMocks.confirmSignalReview,
    ignoreSignalReview: apiMocks.ignoreSignalReview,
    updateSignalReviewNote: apiMocks.updateSignalReviewNote,
  },
  orderApi: {
    getOrders: apiMocks.getOrders,
    createOrder: apiMocks.createOrder,
    cancelOrder: apiMocks.cancelOrder,
    getOrderStatus: apiMocks.getOrderStatus,
    getOrderAudit: apiMocks.getOrderAudit,
    simulateOrders: apiMocks.simulateOrders,
  },
  tradeApi: {
    listTrades: apiMocks.listTrades,
  },
  marketDataApi: {
    searchSymbols: apiMocks.searchSymbols,
  },
}));

vi.mock('recharts', () => {
  const passthrough =
    (testId: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': testId }, children);

  return {
    ResponsiveContainer: passthrough('responsive-container'),
    LineChart: passthrough('line-chart'),
    BarChart: passthrough('bar-chart'),
    Line: passthrough('line'),
    Bar: passthrough('bar'),
    XAxis: passthrough('x-axis'),
    YAxis: passthrough('y-axis'),
    CartesianGrid: passthrough('cartesian-grid'),
    Tooltip: passthrough('tooltip'),
    Legend: passthrough('legend'),
  };
});

import StrategiesPage from '../src/app/strategies/page';
import BacktestPage from '../src/app/backtest/page';
import TradingPage from '../src/app/trading/page';

const strategy = {
  id: 'strategy-001',
  name: 'simple_moving_average',
  display_name: 'Alpha Trend',
  description: 'Baseline trend strategy',
  parameters: {
    symbol: 'AAPL',
    timeframe: '1d',
    initial_capital: 100000,
    fee_bps: 5,
    slippage_bps: 2,
    max_position_fraction: 1,
    short_period: 5,
    long_period: 20,
  },
  risk_limits: {},
  is_active: true,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-02T00:00:00Z',
};

const secondStrategy = {
  id: 'strategy-002',
  name: 'macd',
  display_name: 'Beta Momentum',
  description: 'Secondary momentum strategy',
  parameters: {
    symbol: 'MSFT',
    timeframe: '1d',
    initial_capital: 100000,
    fee_bps: 5,
    slippage_bps: 2,
    max_position_fraction: 1,
    fast_period: 12,
    slow_period: 26,
    signal_period: 9,
  },
  risk_limits: {},
  is_active: true,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-02T00:00:00Z',
};

const backtestResult = {
  run_id: 'run-001',
  experiment_id: 'experiment-001',
  experiment_label: 'Alpha Batch',
  experiment_note: 'batch note',
  parameter_version: 'v1',
  strategy_id: strategy.id,
  strategy_name: strategy.display_name,
  symbol: 'AAPL',
  timeframe: '1d',
  parameters: strategy.parameters,
  trades: [],
  equity_curve: [],
  start_date: '2026-03-01T00:00:00Z',
  end_date: '2026-03-31T00:00:00Z',
  initial_capital: 100000,
  final_capital: 105000,
  total_return: 0.05,
  annualized_return: 0.08,
  sharpe_ratio: 1.2,
  max_drawdown: 0.03,
  win_rate: 0.6,
  total_trades: 3,
  performance_metrics: {
    total_pnl: 5000,
    realized_pnl: 5000,
    unrealized_pnl: 0,
    gross_profit: 7000,
    gross_loss: 2000,
    profit_factor: 3.5,
    average_win: 2333,
    average_loss: 1000,
    largest_win: 4000,
    largest_loss: 1000,
  },
  data_quality: {
    source_label: '本地行情库 + Yahoo Finance 回退',
    local_data_hit: true,
    external_data_fallback: true,
    bar_count: 30,
    minimum_required_bars: 20,
    data_insufficient: false,
    missing_intervals: [],
    notes: ['基于 bar 时间戳的启发式连续性检测'],
  },
  assumptions: {
    fee_bps: 5,
    slippage_bps: 2,
    max_position_fraction: 1,
    rebalancing_logic: '双均线交叉触发调仓，按参数快照中的最大仓位占比上限执行（100%）',
    data_source: '本地行情库 + Yahoo Finance 回退',
  },
  execution_link: {
    status: 'reference_match_only',
    reference_scope: 'strategy_id + symbol + backtest window',
    explicit_link_id: null,
    note: '当前仅按策略、标的和回测区间参考匹配真实执行成交，未建立一一对应关系。',
  },
  created_at: '2026-04-02T01:00:00Z',
};

const siblingBacktestResult = {
  ...backtestResult,
  run_id: 'run-002',
  total_return: 0.06,
  annualized_return: 0.09,
  sharpe_ratio: 1.4,
  created_at: '2026-04-02T02:00:00Z',
};

const strategyState = {
  strategy_id: strategy.id,
  strategy_name: strategy.display_name,
  latest_backtest: {
    source: 'backtest_runs',
    run_id: backtestResult.run_id,
    created_at: backtestResult.created_at,
    strategy_id: strategy.id,
    strategy_name: strategy.display_name,
    symbol: backtestResult.symbol,
    timeframe: backtestResult.timeframe,
    experiment_label: backtestResult.experiment_label,
    parameter_version: backtestResult.parameter_version,
    total_return: backtestResult.total_return,
    annualized_return: backtestResult.annualized_return,
    sharpe_ratio: backtestResult.sharpe_ratio,
    max_drawdown: backtestResult.max_drawdown,
    total_trades: backtestResult.total_trades,
    note: '研究回测结果，仅供参考，不代表真实执行',
  },
  latest_real_trade: null,
  recent_signal: {
    source: 'strategy_engine_latest_snapshot',
    status: 'live',
    confirmation_state: 'manual_review_only',
    strategy_id: strategy.id,
    strategy_name: strategy.display_name,
    symbol: backtestResult.symbol,
    timeframe: backtestResult.timeframe,
    latest_signal_at: '2026-04-02T03:30:00Z',
    generated_at: '2026-04-02T03:30:00Z',
    signal_type: 'Buy',
    strength: 0.82,
    suggested_order: {
      symbol: 'AAPL',
      side: 'Buy',
      quantity: 100,
      strategy_id: strategy.id,
    },
    note: '研究信号仅用于人工确认，不会自动下单。',
  },
  generated_at: '2026-04-02T03:00:00Z',
};

const secondStrategyState = {
  ...strategyState,
  strategy_id: secondStrategy.id,
  strategy_name: secondStrategy.display_name,
  latest_backtest: {
    ...strategyState.latest_backtest,
    strategy_id: secondStrategy.id,
    strategy_name: secondStrategy.display_name,
    symbol: secondStrategy.parameters.symbol,
  },
  recent_signal: {
    ...strategyState.recent_signal,
    strategy_id: secondStrategy.id,
    strategy_name: secondStrategy.display_name,
    symbol: secondStrategy.parameters.symbol,
    latest_signal_at: '2026-04-02T03:40:00Z',
    generated_at: '2026-04-02T03:40:00Z',
    signal_type: 'Sell',
    strength: 0.67,
    suggested_order: {
      symbol: 'MSFT',
      side: 'Sell',
      quantity: 100,
      strategy_id: secondStrategy.id,
    },
    note: '第二条策略的人工复核快照。',
  },
};

const latestSignalSnapshot = {
  strategy_id: strategy.id,
  strategy_name: strategy.display_name,
  symbol: 'AAPL',
  timeframe: '1d',
  signal_type: 'Buy',
  strength: 0.82,
  generated_at: '2026-04-02T04:00:00Z',
  source: 'strategy_engine_latest_snapshot',
  confirmation_state: 'manual_review_only',
  note: '研究信号仅用于人工确认，不会自动下单。',
  suggested_order: {
    symbol: 'AAPL',
    side: 'Buy',
    quantity: 100,
    strategy_id: strategy.id,
  },
};

const latestSecondSignalSnapshot = {
  strategy_id: secondStrategy.id,
  strategy_name: secondStrategy.display_name,
  symbol: 'MSFT',
  timeframe: '1d',
  signal_type: 'Sell',
  strength: 0.67,
  generated_at: '2026-04-02T04:05:00Z',
  source: 'strategy_engine_latest_snapshot',
  confirmation_state: 'manual_review_only',
  note: '研究信号仅用于人工确认，不会自动下单。',
  suggested_order: {
    symbol: 'MSFT',
    side: 'Sell',
    quantity: 100,
    strategy_id: secondStrategy.id,
  },
};

const refreshedSecondSignalSnapshot = {
  ...latestSecondSignalSnapshot,
  generated_at: '2026-04-02T05:00:00Z',
  note: '刷新后的第二条策略信号。',
};

const pendingReviewOne = {
  id: 'review-001',
  strategy_id: strategy.id,
  strategy_name: strategy.display_name,
  symbol: 'AAPL',
  timeframe: '1d',
  signal_type: 'Buy',
  strength: 0.82,
  generated_at: '2026-04-02T04:00:00Z',
  source: 'strategy_engine_latest_snapshot',
  confirmation_state: 'manual_review_only',
  note: '研究信号仅用于人工确认，不会自动下单。',
  status: 'pending',
  user_note: null,
  suggested_order: {
    symbol: 'AAPL',
    side: 'Buy',
    quantity: 100,
    strategy_id: strategy.id,
  },
  created_at: '2026-04-02T04:00:00Z',
  updated_at: '2026-04-02T04:00:00Z',
};

const pendingReviewTwo = {
  id: 'review-002',
  strategy_id: secondStrategy.id,
  strategy_name: secondStrategy.display_name,
  symbol: 'MSFT',
  timeframe: '1d',
  signal_type: 'Sell',
  strength: 0.67,
  generated_at: '2026-04-02T04:05:00Z',
  source: 'strategy_engine_latest_snapshot',
  confirmation_state: 'manual_review_only',
  note: '研究信号仅用于人工确认，不会自动下单。',
  status: 'pending',
  user_note: '请关注财报窗口',
  suggested_order: {
    symbol: 'MSFT',
    side: 'Sell',
    quantity: 100,
    strategy_id: secondStrategy.id,
  },
  created_at: '2026-04-02T04:05:00Z',
  updated_at: '2026-04-02T04:05:00Z',
};

function renderWithQueryClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, ui)
  );
}

describe('UI smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiMocks.getStrategies.mockResolvedValue([strategy, secondStrategy]);
    apiMocks.createStrategy.mockResolvedValue({ id: 'created-strategy' });
    apiMocks.updateStrategy.mockResolvedValue({ id: strategy.id });
    apiMocks.deleteStrategy.mockResolvedValue(undefined);
    apiMocks.runBacktest.mockResolvedValue({ run_id: backtestResult.run_id });
    apiMocks.runBacktestBatch.mockResolvedValue({ count: 2, results: [backtestResult, backtestResult] });
    apiMocks.listBacktestsWithFilters.mockResolvedValue([backtestResult, siblingBacktestResult]);
    apiMocks.getStrategyState.mockImplementation(async (strategyId: string) =>
      strategyId === secondStrategy.id ? secondStrategyState : strategyState
    );
    apiMocks.listLatestSignals.mockResolvedValue([latestSignalSnapshot, latestSecondSignalSnapshot]);
    apiMocks.refreshStrategySignal.mockImplementation(async (strategyId: string) =>
      strategyId === secondStrategy.id ? refreshedSecondSignalSnapshot : latestSignalSnapshot
    );
    apiMocks.listSignalReviews.mockResolvedValue([pendingReviewOne, pendingReviewTwo]);
    apiMocks.confirmSignalReview.mockResolvedValue(pendingReviewOne);
    apiMocks.ignoreSignalReview.mockResolvedValue(pendingReviewTwo);
    apiMocks.updateSignalReviewNote.mockResolvedValue(pendingReviewTwo);
    apiMocks.getOrders.mockResolvedValue([]);
    apiMocks.createOrder.mockResolvedValue({ accepted: true });
    apiMocks.cancelOrder.mockResolvedValue(undefined);
    apiMocks.getOrderStatus.mockResolvedValue({} as any);
    apiMocks.getOrderAudit.mockResolvedValue({ order_id: 'order-001', entries: [] });
    apiMocks.simulateOrders.mockResolvedValue({
      processed: 0,
      filled: 0,
      partially_filled: 0,
      submitted: 0,
      untouched: 0,
      unsupported: 0,
      results: [],
    });
    apiMocks.listTrades.mockResolvedValue([]);
    apiMocks.searchSymbols.mockResolvedValue([]);

    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:smoke'),
        revokeObjectURL: vi.fn(),
      })
    );
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it('drives the strategy page happy path through create, edit, delete, and run backtest', async () => {
    const user = userEvent.setup();
    const { container } = renderWithQueryClient(React.createElement(StrategiesPage));

    await screen.findByText('Alpha Trend');

    await user.click(screen.getAllByRole('button', { name: '新建策略' })[0]);
    await screen.findByRole('heading', { name: '新建策略' });
    const createForm = screen.getByRole('button', { name: '创建策略' }).closest('form');
    expect(createForm).not.toBeNull();
    fireEvent.submit(createForm as HTMLFormElement);

    await waitFor(() => {
      expect(apiMocks.createStrategy).toHaveBeenCalledTimes(1);
    });

    const editButton = container.querySelector('button[title="编辑策略"]') as HTMLButtonElement;
    await user.click(editButton);
    await screen.findByRole('heading', { name: '编辑策略' });
    const editForm = screen.getByRole('button', { name: '保存修改' }).closest('form');
    expect(editForm).not.toBeNull();
    fireEvent.submit(editForm as HTMLFormElement);

    await waitFor(() => {
      expect(apiMocks.updateStrategy).toHaveBeenCalledTimes(1);
    });

    const deleteButton = container.querySelector('button[title="删除策略"]') as HTMLButtonElement;
    await user.click(deleteButton);

    await waitFor(() => {
      expect(confirm).toHaveBeenCalled();
      expect(apiMocks.deleteStrategy).toHaveBeenCalled();
      expect(apiMocks.deleteStrategy.mock.calls[0]?.[0]).toBe(strategy.id);
    });

    const backtestButton = container.querySelector('button[title="运行回测"]') as HTMLButtonElement;
    await user.click(backtestButton);
    await screen.findByRole('heading', { name: '运行回测' });

    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0] as HTMLInputElement, { target: { value: '2026-03-01' } });
    fireEvent.change(dateInputs[1] as HTMLInputElement, { target: { value: '2026-03-31' } });
    const backtestForm = screen.getAllByRole('button', { name: '运行回测' }).at(-1)?.closest('form');
    expect(backtestForm).not.toBeNull();
    fireEvent.submit(backtestForm as HTMLFormElement);

    await waitFor(() => {
      expect(apiMocks.runBacktest).toHaveBeenCalledWith(
        strategy.id,
        '2026-03-01',
        '2026-03-31',
        expect.objectContaining({
          experiment_label: 'Alpha Trend 实验',
          experiment_note: 'Baseline trend strategy',
          parameter_version: expect.stringMatching(/^v\d{4}-\d{2}-\d{2}$/),
        })
      );
      expect(alert).toHaveBeenCalled();
    });
  });

  it('drives the backtest page through detail toggle and experiment export actions', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(React.createElement(BacktestPage));

    await screen.findAllByText('Alpha Trend');

    await user.click(screen.getAllByRole('button', { name: '查看详情' })[0]);
    await screen.findByText('运行元数据');
    await screen.findByText('可信度与回测假设');
    await screen.findByText('研究与真实执行复盘');
    await screen.findByText('本地数据命中');
    await screen.findByText(/参考匹配真实执行成交/);
    await screen.findByText('最新信号快照');
    await screen.findByText(/建议订单: Buy \/ 100 股/);
    await screen.findByText(/该信号仅用于人工确认，不会自动触发下单/);
    await user.click(screen.getAllByRole('button', { name: '收起详情' })[0]);

    await waitFor(() => {
      expect(screen.queryByText('运行元数据')).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: '导出筛选 JSON' }));
    await user.click(screen.getByRole('button', { name: '导出筛选 CSV' }));
    await user.click(screen.getAllByRole('button', { name: '快照 JSON' })[0]);
    await user.click(screen.getAllByRole('button', { name: '对比同批次' })[0]);
    await user.click(screen.getAllByRole('button', { name: '导出批次 JSON' })[0]);

    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
      expect(screen.getByText(/当前导出的是同一实验批次/)).toBeTruthy();
    });
  });

  it('shows the pending signal queue on the trading page', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(React.createElement(TradingPage));

    await screen.findByText('待处理信号队列');
    await screen.findAllByRole('button', { name: /按此信号预填订单/ });
    await screen.findAllByRole('button', { name: '标记已确认' });
    await screen.findAllByRole('button', { name: '忽略' });
    await waitFor(() => {
      expect(apiMocks.listSignalReviews).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' })
      );
    });

    await user.click(screen.getAllByRole('button', { name: /按此信号预填订单/ })[1]);

    await screen.findByRole('heading', { name: '新建订单' });
    const orderForm = screen.getByRole('button', { name: '提交订单' }).closest('form');
    expect(orderForm).not.toBeNull();
    fireEvent.submit(orderForm as HTMLFormElement);

    await waitFor(() => {
      expect(apiMocks.createOrder.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          symbol: 'MSFT',
          side: 'Sell',
          quantity: 100,
          order_type: 'Market',
          strategy_id: secondStrategy.id,
        })
      );
    });

    await user.click(screen.getAllByRole('button', { name: '标记已确认' })[0]);

    await waitFor(() => {
      expect(apiMocks.confirmSignalReview).toHaveBeenCalledWith(pendingReviewOne.id);
    });

    await user.click(screen.getAllByRole('button', { name: '忽略' })[0]);

    await waitFor(() => {
      expect(apiMocks.ignoreSignalReview).toHaveBeenCalledWith(pendingReviewTwo.id);
    });
  });
});
