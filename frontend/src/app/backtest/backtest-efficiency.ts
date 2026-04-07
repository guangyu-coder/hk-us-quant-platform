import type { BacktestResult } from '@/types';

export interface BacktestExportRow {
  run_key: string;
  run_id: string;
  experiment_id: string;
  experiment_label: string;
  experiment_note: string;
  parameter_version: string;
  strategy_id: string;
  strategy_name: string;
  run_snapshot_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  created_at: string;
  initial_capital: number;
  final_capital: number;
  total_return: number;
  annualized_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  win_rate: number;
  total_trades: number;
}

export function getBacktestResultKey(
  result: Pick<
    BacktestResult,
    'run_id' | 'strategy_id' | 'symbol' | 'timeframe' | 'start_date' | 'end_date' | 'created_at' | 'parameters'
  >
): string {
  if (result.run_id?.trim()) {
    return `run-${result.run_id.trim()}`;
  }

  const composite = [
    result.strategy_id,
    result.symbol ?? '',
    result.timeframe ?? '',
    result.start_date,
    result.end_date,
    result.created_at ?? '',
    JSON.stringify(result.parameters ?? {}),
  ].join('::');

  return `backtest-${encodeURIComponent(composite)}`;
}

export function buildBacktestExportRows(
  results: BacktestResult[],
  resolveStrategyName: (result: BacktestResult) => string
): BacktestExportRow[] {
  return results.map((result) => ({
    run_key: getBacktestResultKey(result),
    run_id: result.run_id?.trim() || '-',
    experiment_id: result.experiment_id?.trim() || '-',
    experiment_label: result.experiment_label?.trim() || '-',
    experiment_note: result.experiment_note?.trim() || '-',
    parameter_version: result.parameter_version?.trim() || '-',
    strategy_id: result.strategy_id,
    strategy_name: resolveStrategyName(result).trim() || result.strategy_id,
    run_snapshot_name: result.strategy_name?.trim() || '-',
    symbol: result.symbol?.trim() || '-',
    timeframe: result.timeframe?.trim() || '-',
    start_date: result.start_date,
    end_date: result.end_date,
    created_at: result.created_at ?? '-',
    initial_capital: result.initial_capital,
    final_capital: result.final_capital,
    total_return: result.total_return,
    annualized_return: result.annualized_return,
    max_drawdown: result.max_drawdown,
    sharpe_ratio: result.sharpe_ratio,
    win_rate: result.win_rate,
    total_trades: result.total_trades,
  }));
}

export function serializeBacktestExportRowsToJson(rows: BacktestExportRow[]): string {
  return JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      count: rows.length,
      rows,
    },
    null,
    2
  );
}

export function serializeBacktestExportRowsToCsv(rows: BacktestExportRow[]): string {
  const headers: Array<keyof BacktestExportRow> = [
    'run_key',
    'run_id',
    'experiment_id',
    'experiment_label',
    'experiment_note',
    'parameter_version',
    'strategy_id',
    'strategy_name',
    'run_snapshot_name',
    'symbol',
    'timeframe',
    'start_date',
    'end_date',
    'created_at',
    'initial_capital',
    'final_capital',
    'total_return',
    'annualized_return',
    'max_drawdown',
    'sharpe_ratio',
    'win_rate',
    'total_trades',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
  ];

  return lines.join('\n');
}

function escapeCsvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
