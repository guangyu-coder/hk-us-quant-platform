import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BacktestResult } from '../src/types/index.ts';
import {
  buildBacktestExportRows,
  getBacktestResultKey,
  serializeBacktestExportRowsToCsv,
  serializeBacktestExportRowsToJson,
} from '../src/app/backtest/backtest-efficiency.ts';

const sampleResult = {
  run_id: 'run-123',
  experiment_id: 'experiment-123',
  experiment_label: 'Alpha Batch',
  experiment_note: 'note',
  parameter_version: 'v1.0',
  strategy_id: 'strategy-1',
  strategy_name: 'Legacy Momentum',
  symbol: 'AAPL',
  timeframe: '1d',
  parameters: { lookback: 20 },
  trades: [],
  equity_curve: [],
  start_date: '2025-01-01',
  end_date: '2025-01-31',
  initial_capital: 100000,
  final_capital: 108500,
  total_return: 0.085,
  annualized_return: 0.31,
  sharpe_ratio: 1.42,
  max_drawdown: 0.09,
  win_rate: 0.58,
  total_trades: 24,
  performance_metrics: {
    total_pnl: 8500,
    realized_pnl: 8200,
    unrealized_pnl: 300,
    gross_profit: 12000,
    gross_loss: 3500,
    profit_factor: 3.43,
    average_win: 140,
    average_loss: -85,
    largest_win: 420,
    largest_loss: -260,
  },
  data_quality: {
    source_label: '本地行情库',
    local_data_hit: true,
    external_data_fallback: false,
    bar_count: 24,
    minimum_required_bars: 20,
    data_insufficient: false,
    missing_intervals: [],
    notes: [],
  },
  assumptions: {
    fee_bps: 5,
    slippage_bps: 2,
    max_position_fraction: 1,
    rebalancing_logic: '信号触发调仓',
    data_source: '本地行情库',
  },
  execution_link: {
    status: 'reference_match_only',
    reference_scope: 'strategy_id + symbol + backtest window',
    explicit_link_id: null,
    note: 'reference only',
  },
} satisfies BacktestResult;

test('buildBacktestExportRows resolves names and keeps a stable key', () => {
  const rows = buildBacktestExportRows([sampleResult], () => 'Alpha, "Core"');

  assert.equal(getBacktestResultKey(sampleResult), 'run-run-123');
  assert.equal(rows[0].strategy_name, 'Alpha, "Core"');
  assert.equal(rows[0].experiment_label, 'Alpha Batch');
  assert.equal(rows[0].parameter_version, 'v1.0');
  assert.equal(rows[0].run_snapshot_name, 'Legacy Momentum');
  assert.match(rows[0].data_quality_summary, /本地行情库/);
  assert.match(rows[0].assumptions_summary, /手续费 5bps/);
  assert.equal(rows[0].execution_link_summary, 'reference_match_only');
  assert.equal(rows[0].total_return, 0.085);
  assert.equal(rows[0].win_rate, 0.58);
});

test('serializeBacktestExportRowsToCsv escapes quoted text', () => {
  const rows = buildBacktestExportRows([sampleResult], () => 'Alpha, "Core"');
  const csv = serializeBacktestExportRowsToCsv(rows);

  assert.match(csv, /strategy_name/);
  assert.match(csv, /run_snapshot_name/);
  assert.match(csv, /"Alpha, ""Core"""/);
  assert.match(csv, /Legacy Momentum/);
});

test('serializeBacktestExportRowsToJson preserves the run snapshot name', () => {
  const rows = buildBacktestExportRows([sampleResult], () => 'Alpha, "Core"');
  const json = serializeBacktestExportRowsToJson(rows);
  const parsed = JSON.parse(json);

  assert.equal(parsed.count, 1);
  assert.equal(parsed.rows[0].strategy_name, 'Alpha, "Core"');
  assert.equal(parsed.rows[0].experiment_id, 'experiment-123');
  assert.equal(parsed.rows[0].run_snapshot_name, 'Legacy Momentum');
});
