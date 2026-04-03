import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCreateStrategyPayload,
  buildDeleteStrategyConfirmation,
  buildUpdateStrategyPayload,
} from '../src/app/strategies/strategy-page-helpers.ts';
import {
  buildBacktestExportFilename,
  canExportBacktests,
  toggleExpandedRunId,
} from '../src/app/backtest/backtest-page-helpers.ts';
import {
  buildBacktestExportRows,
  getBacktestResultKey,
  serializeBacktestExportRowsToCsv,
  serializeBacktestExportRowsToJson,
} from '../src/app/backtest/backtest-efficiency.ts';
import { createStrategyFormState } from '../src/lib/strategy-form.ts';
import type { BacktestResult, StrategyConfig } from '../src/types/index.ts';

const baseStrategy = createStrategyFormState('simple_moving_average');
const liveStrategy: StrategyConfig = {
  id: 'strategy-001',
  name: 'simple_moving_average',
  display_name: 'Alpha Trend',
  description: 'Baseline happy path',
  parameters: {
    ...baseStrategy.parameters,
    symbol: 'AAPL',
    timeframe: '1d',
    short_period: 5,
    long_period: 20,
  },
  risk_limits: {},
  is_active: true,
  created_at: '2026-04-02T00:00:00Z',
  updated_at: '2026-04-02T00:00:00Z',
};

const backtestRun: BacktestResult = {
  run_id: 'run-001',
  strategy_id: liveStrategy.id,
  strategy_name: liveStrategy.display_name,
  symbol: 'AAPL',
  timeframe: '1d',
  parameters: liveStrategy.parameters,
  trades: [],
  equity_curve: [],
  start_date: '2026-03-01T00:00:00Z',
  end_date: '2026-03-31T00:00:00Z',
  initial_capital: 100000,
  final_capital: 108000,
  total_return: 0.08,
  annualized_return: 0.11,
  sharpe_ratio: 1.35,
  max_drawdown: 0.04,
  win_rate: 0.62,
  total_trades: 4,
  performance_metrics: {
    total_pnl: 8000,
    realized_pnl: 8000,
    unrealized_pnl: 0,
    gross_profit: 9500,
    gross_loss: 1500,
    profit_factor: 6.33,
    average_win: 2375,
    average_loss: 500,
    largest_win: 3200,
    largest_loss: 500,
  },
  created_at: '2026-04-02T01:00:00Z',
};

test('smoke: strategy research happy path stays intact', () => {
  const createPayload = buildCreateStrategyPayload(baseStrategy);
  assert.equal(createPayload.display_name, 'SMA 双均线');
  assert.equal(createPayload.parameters.symbol, 'AAPL');

  const updatedPayload = buildUpdateStrategyPayload({
    ...baseStrategy,
    display_name: '  Alpha Trend v2  ',
    description: 'Updated baseline',
    parameters: {
      ...baseStrategy.parameters,
      symbol: 'MSFT',
    },
  });
  assert.equal(updatedPayload.display_name, 'Alpha Trend v2');
  assert.equal(updatedPayload.parameters.symbol, 'MSFT');

  const deleteCopy = buildDeleteStrategyConfirmation(liveStrategy);
  assert.match(deleteCopy, /Alpha Trend/);

  const runKey = getBacktestResultKey(backtestRun);
  const expanded = toggleExpandedRunId(null, runKey);
  const collapsed = toggleExpandedRunId(expanded, runKey);
  assert.equal(expanded, runKey);
  assert.equal(collapsed, null);

  const exportRows = buildBacktestExportRows([backtestRun], (result) => liveStrategy.display_name || result.strategy_id);
  assert.equal(canExportBacktests(exportRows.length), true);

  const exportName = buildBacktestExportFilename('smoke', new Date('2026-04-02T03:04:05.678Z'));
  assert.equal(exportName, 'backtest-smoke-2026-04-02T03-04-05-678Z');

  const json = serializeBacktestExportRowsToJson(exportRows);
  const csv = serializeBacktestExportRowsToCsv(exportRows);
  assert.match(json, /Alpha Trend/);
  assert.match(csv, /strategy_name/);
  assert.match(csv, /Alpha Trend/);
});
