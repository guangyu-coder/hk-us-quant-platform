import type { BacktestResult, ExecutionTrade, StrategyConfig } from '@/types';

export function deriveBacktestStrategyName(
  result: Pick<BacktestResult, 'strategy_id' | 'strategy_name'>,
  strategy?: Pick<StrategyConfig, 'id' | 'name' | 'display_name'>
): string {
  if (strategy?.id === result.strategy_id) {
    return strategy.display_name?.trim() || strategy.name;
  }

  return result.strategy_name?.trim() || result.strategy_id;
}

export function deriveRunSnapshotName(
  result: Pick<BacktestResult, 'strategy_name'>,
  strategy?: Pick<StrategyConfig, 'name' | 'display_name'>
): string | null {
  const snapshotName = result.strategy_name?.trim();
  if (!snapshotName) {
    return null;
  }

  const currentNames = new Set(
    [strategy?.display_name, strategy?.name]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim())
  );

  return currentNames.has(snapshotName) ? null : snapshotName;
}

export function getReferenceTradesForBacktestWindow(
  result: Pick<BacktestResult, 'strategy_id' | 'strategy_name' | 'symbol' | 'start_date' | 'end_date'>,
  executionTrades: ExecutionTrade[],
  strategy?: Pick<StrategyConfig, 'id' | 'name' | 'display_name'>
): ExecutionTrade[] {
  const candidateIds = new Set(
    [result.strategy_id, result.strategy_name, strategy?.id, strategy?.name, strategy?.display_name]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
  );

  return executionTrades.filter((trade) => {
    if (!trade.strategy_id || !candidateIds.has(trade.strategy_id.toLowerCase())) {
      return false;
    }

    if (result.symbol && trade.symbol !== result.symbol) {
      return false;
    }

    const executedAt = new Date(trade.executed_at).getTime();
    const start = new Date(result.start_date).getTime();
    const end = new Date(result.end_date).getTime();
    return executedAt >= start && executedAt <= end;
  });
}

export function getNextExpandedRunId(
  expandedRunId: string | null,
  targetRunId: string
): string | null {
  return expandedRunId === targetRunId ? null : targetRunId;
}

export function buildBacktestFilterSummary(filters: {
  selectedStrategyName?: string;
  strategyNameKeyword?: string;
  symbol?: string;
}): string {
  const items = [
    filters.selectedStrategyName?.trim() ? `策略: ${filters.selectedStrategyName.trim()}` : null,
    filters.strategyNameKeyword?.trim()
      ? `名称关键字: ${filters.strategyNameKeyword.trim()}`
      : null,
    filters.symbol?.trim() ? `标的: ${filters.symbol.trim()}` : null,
  ].filter((value): value is string => Boolean(value));

  return items.length > 0 ? items.join(' · ') : '全部回测结果';
}

export function hasActiveBacktestFilters(filters: {
  selectedStrategyId?: string;
  strategyNameKeyword?: string;
  symbol?: string;
}): boolean {
  return (
    Boolean(filters.selectedStrategyId && filters.selectedStrategyId !== 'all') ||
    Boolean(filters.strategyNameKeyword?.trim()) ||
    Boolean(filters.symbol?.trim())
  );
}

export function buildParameterSnapshotSummary(
  parameters?: Record<string, unknown>
): string[] {
  if (!parameters) {
    return [];
  }

  const items = [
    parameters.symbol ? `标的 ${String(parameters.symbol)}` : null,
    parameters.timeframe ? `周期 ${String(parameters.timeframe)}` : null,
    parameters.initial_capital != null
      ? `初始资金 ${formatParameterNumber(parameters.initial_capital)}`
      : null,
    parameters.fee_bps != null ? `手续费 ${formatParameterNumber(parameters.fee_bps)}bps` : null,
    parameters.slippage_bps != null
      ? `滑点 ${formatParameterNumber(parameters.slippage_bps)}bps`
      : null,
    parameters.short_period != null && parameters.long_period != null
      ? `均线 ${formatParameterNumber(parameters.short_period)}/${formatParameterNumber(parameters.long_period)}`
      : null,
    parameters.period != null ? `周期参数 ${formatParameterNumber(parameters.period)}` : null,
    parameters.fast_period != null &&
    parameters.slow_period != null &&
    parameters.signal_period != null
      ? `MACD ${formatParameterNumber(parameters.fast_period)}/${formatParameterNumber(parameters.slow_period)}/${formatParameterNumber(parameters.signal_period)}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return items;
}

function formatParameterNumber(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  return String(value);
}
