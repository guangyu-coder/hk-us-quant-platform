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
  data_quality_summary: string;
  assumptions_summary: string;
  execution_link_summary: string;
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
    data_quality_summary: summarizeDataQuality(result),
    assumptions_summary: summarizeAssumptions(result),
    execution_link_summary: summarizeExecutionLink(result),
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
    'data_quality_summary',
    'assumptions_summary',
    'execution_link_summary',
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

function summarizeDataQuality(result: BacktestResult): string {
  const quality = result.data_quality;
  if (!quality) {
    return '-';
  }

  const flags = [
    quality.local_data_hit ? '本地命中' : null,
    quality.external_data_fallback ? '外部回退' : null,
    quality.data_insufficient ? '数据不足' : null,
    quality.missing_intervals.length > 0 ? `缺口 ${quality.missing_intervals.length}` : null,
  ].filter((value): value is string => Boolean(value));

  return `${quality.source_label || '-'} | ${flags.join('、') || '暂无标识'}`;
}

function summarizeAssumptions(result: BacktestResult): string {
  const assumptions = result.assumptions;
  if (!assumptions) {
    return '-';
  }

  return [
    `手续费 ${assumptions.fee_bps}bps`,
    `滑点 ${assumptions.slippage_bps}bps`,
    `最大仓位 ${Math.round(assumptions.max_position_fraction * 100)}%`,
    `调仓 ${assumptions.rebalancing_logic}`,
    `数据源 ${assumptions.data_source}`,
  ].join(' | ');
}

function summarizeExecutionLink(result: BacktestResult): string {
  const link = result.execution_link;
  if (!link) {
    return 'reference_match_only';
  }

  return `${link.status}${link.explicit_link_id ? `:${link.explicit_link_id}` : ''}`;
}
