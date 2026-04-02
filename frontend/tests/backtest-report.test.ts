import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBacktestFilterSummary,
  buildParameterSnapshotSummary,
  deriveBacktestStrategyName,
  deriveRunSnapshotName,
  getNextExpandedRunId,
  getReferenceTradesForBacktestWindow,
} from '../src/app/backtest/report-helpers.ts';
import type { BacktestResult, ExecutionTrade, StrategyConfig } from '../src/types/index.ts';

const strategy: StrategyConfig = {
  id: 'strategy-1',
  name: 'simple_moving_average',
  display_name: 'SMA Alpha',
  description: 'test',
  parameters: {
    symbol: 'AAPL',
    timeframe: '1d',
  },
  risk_limits: {},
  is_active: true,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const result: BacktestResult = {
  run_id: 'run-1',
  strategy_id: 'strategy-1',
  strategy_name: 'SMA Legacy Snapshot',
  symbol: 'AAPL',
  timeframe: '1d',
  parameters: {
    symbol: 'AAPL',
    timeframe: '1d',
    initial_capital: 100000,
    short_period: 5,
    long_period: 20,
  },
  trades: [
    {
      timestamp: '2026-03-05T00:00:00Z',
      side: 'buy',
      quantity: 10,
      signal_price: 100,
      execution_price: 100.5,
      fees: 1,
      pnl: null,
    },
  ],
  equity_curve: [],
  start_date: '2026-03-01T00:00:00Z',
  end_date: '2026-03-31T00:00:00Z',
  initial_capital: 100000,
  final_capital: 110000,
  total_return: 0.1,
  annualized_return: 0.12,
  sharpe_ratio: 1.5,
  max_drawdown: 0.05,
  win_rate: 0.5,
  total_trades: 1,
  performance_metrics: {
    total_pnl: 10000,
    realized_pnl: 10000,
    unrealized_pnl: 0,
    gross_profit: 12000,
    gross_loss: 2000,
    profit_factor: 6,
    average_win: 12000,
    average_loss: 2000,
    largest_win: 12000,
    largest_loss: 2000,
  },
  created_at: '2026-04-01T00:00:00Z',
};

test('backtest display name prefers current strategy display name over stored name', () => {
  assert.equal(deriveBacktestStrategyName(result, strategy), 'SMA Alpha');
});

test('run snapshot name remains available when it differs from current strategy naming', () => {
  assert.equal(deriveRunSnapshotName(result, strategy), 'SMA Legacy Snapshot');
});

test('reference trades stay separate from simulated trades semantics', () => {
  const executionTrades: ExecutionTrade[] = [
    {
      id: 1,
      order_id: 'order-1',
      symbol: 'AAPL',
      side: 'BUY',
      quantity: 10,
      price: 101,
      executed_at: '2026-03-10T00:00:00Z',
      portfolio_id: 'paper',
      strategy_id: 'strategy-1',
    },
    {
      id: 2,
      order_id: 'order-2',
      symbol: 'MSFT',
      side: 'BUY',
      quantity: 5,
      price: 200,
      executed_at: '2026-03-10T00:00:00Z',
      portfolio_id: 'paper',
      strategy_id: 'strategy-1',
    },
  ];

  const realTrades = getReferenceTradesForBacktestWindow(result, executionTrades, strategy);

  assert.equal(realTrades.length, 1);
  assert.equal(realTrades[0]?.id, 1);
  assert.equal(result.trades?.length, 1);
  assert.equal(result.trades?.[0]?.execution_price, 100.5);
});

test('detail expand collapse state remains stable for repeated toggles', () => {
  assert.equal(getNextExpandedRunId(null, 'run-1'), 'run-1');
  assert.equal(getNextExpandedRunId('run-1', 'run-1'), null);
  assert.equal(getNextExpandedRunId('run-1', 'run-2'), 'run-2');
});

test('filter summary shows active values at a glance', () => {
  assert.equal(
    buildBacktestFilterSummary({
      selectedStrategyName: 'SMA Alpha',
      strategyNameKeyword: 'alpha',
      symbol: 'AAPL',
    }),
    '策略: SMA Alpha · 名称关键字: alpha · 标的: AAPL'
  );
});

test('parameter snapshot summary stays human readable', () => {
  assert.deepEqual(buildParameterSnapshotSummary(result.parameters), [
    '标的 AAPL',
    '周期 1d',
    '初始资金 100000',
    '均线 5/20',
  ]);
});
