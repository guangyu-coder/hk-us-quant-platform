import type { RiskLimits, StrategyConfig } from '../../types/index.ts';
import type { StrategyPresetKey } from '../../lib/strategy-form.ts';

export type StrategyFormSubmission = {
  name: StrategyPresetKey;
  display_name: string;
  description: string;
  parameters: Record<string, unknown>;
  risk_limits: RiskLimits;
  is_active: boolean;
};

export function normalizeStrategyCollection(strategies: unknown): StrategyConfig[] {
  if (Array.isArray(strategies)) {
    return strategies as StrategyConfig[];
  }

  if (strategies && typeof strategies === 'object') {
    const envelope = strategies as { strategies?: unknown };
    if (Array.isArray(envelope.strategies)) {
      return envelope.strategies as StrategyConfig[];
    }
  }

  return [];
}

export function buildCreateStrategyPayload(form: StrategyFormSubmission) {
  return {
    ...form,
    name: form.name,
    display_name: form.display_name.trim(),
  };
}

export function buildUpdateStrategyPayload(form: StrategyFormSubmission) {
  return {
    name: form.name,
    display_name: form.display_name.trim(),
    description: form.description,
    parameters: form.parameters,
    risk_limits: form.risk_limits,
    is_active: form.is_active,
  };
}

export function buildDeleteStrategyConfirmation(strategy: Pick<StrategyConfig, 'name' | 'display_name'>) {
  const strategyName = strategy.display_name?.trim() || strategy.name;
  return `确定要删除策略“${strategyName}”吗？\n\n此操作会同时删除该策略关联的订单、成交、回测记录和绩效数据，且无法恢复。`;
}

export function deriveStrategyCounts(strategies: Pick<StrategyConfig, 'is_active'>[]) {
  const activeCount = strategies.filter((strategy) => strategy.is_active).length;
  return {
    totalCount: strategies.length,
    activeCount,
    inactiveCount: strategies.length - activeCount,
  };
}
