import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBacktestFilterSummary,
  buildParameterSnapshotSummary,
  describeBacktestExperiment,
  describeBacktestAssumptions,
  describeBacktestDataQuality,
  describeBacktestExecutionLink,
  deriveBacktestStrategyName,
  deriveRunSnapshotName,
  formatBacktestMissingInterval,
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
  data_quality: {
    source_label: '本地行情库 + Yahoo Finance 回退',
    local_data_hit: true,
    external_data_fallback: true,
    bar_count: 28,
    minimum_required_bars: 20,
    data_insufficient: false,
    missing_intervals: [
      {
        start: '2026-03-12T00:00:00Z',
        end: '2026-03-13T00:00:00Z',
        expected_interval_seconds: 86400,
        observed_interval_seconds: 259200,
        missing_bars_hint: 2,
      },
    ],
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
      experimentLabel: 'Batch 1',
      parameterVersion: 'v1',
      createdAfter: '2026-04-01',
      createdBefore: '2026-04-03',
      sortLabel: '最新',
    }),
    '策略: SMA Alpha · 名称关键字: alpha · 标的: AAPL · 标签: Batch 1 · 版本: v1 · 起始: 2026-04-01 · 结束: 2026-04-03 · 排序: 最新'
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

test('experiment summary highlights batch metadata', () => {
  assert.deepEqual(
    describeBacktestExperiment({
      experiment_id: '12345678-aaaa-bbbb-cccc-123456789abc',
      experiment_label: 'Batch 1',
      experiment_note: 'note',
      parameter_version: 'v1',
    }),
    ['标签 Batch 1', '版本 v1', '备注 note', '实验 12345678']
  );
});

test('confidence helpers surface data quality and reference-only execution semantics', () => {
  assert.deepEqual(describeBacktestDataQuality(result), [
    '数据源 本地行情库 + Yahoo Finance 回退',
    '本地数据命中',
    '外部数据回退',
    'bar 数 28',
    '缺失区间 1 处',
  ]);
  assert.deepEqual(describeBacktestAssumptions(result), [
    '手续费 5bps',
    '滑点 2bps',
    '最大仓位 100%',
    '调仓 双均线交叉触发调仓，按参数快照中的最大仓位占比上限执行（100%）',
    '数据源 本地行情库 + Yahoo Finance 回退',
  ]);
  assert.match(describeBacktestExecutionLink(result), /参考匹配真实执行成交/);
});

test('missing interval formatter keeps gap details readable', () => {
  const formatted = formatBacktestMissingInterval({
    start: '2026-03-12T00:00:00Z',
    end: '2026-03-13T00:00:00Z',
    expected_interval_seconds: 86400,
    observed_interval_seconds: 259200,
    missing_bars_hint: 2,
  });

  assert.match(formatted, /缺口约 2 根 bar/);
  assert.match(formatted, /2026/);
});
