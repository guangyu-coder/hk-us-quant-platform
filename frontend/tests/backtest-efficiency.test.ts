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
} satisfies BacktestResult;

test('buildBacktestExportRows resolves names and keeps a stable key', () => {
  const rows = buildBacktestExportRows([sampleResult], () => 'Alpha, "Core"');

  assert.equal(getBacktestResultKey(sampleResult), 'run-run-123');
  assert.equal(rows[0].strategy_name, 'Alpha, "Core"');
  assert.equal(rows[0].run_snapshot_name, 'Legacy Momentum');
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
  assert.equal(parsed.rows[0].run_snapshot_name, 'Legacy Momentum');
});
