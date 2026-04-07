import { STRATEGY_PRESETS, type StrategyPresetKey } from '../../lib/strategy-form.ts';
import type { StrategyConfig } from '../../types/index.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const RECENT_SYMBOLS_STORAGE_KEY = 'strategy-page:recent-symbols';
export const MAX_RECENT_SYMBOLS = 8;

export const COMMON_SYMBOL_SHORTCUTS = [
  'AAPL',
  'MSFT',
  'NVDA',
  'TSLA',
  'AMZN',
  'GOOGL',
  '0700.HK',
  '9988.HK',
] as const;

export const STRATEGY_TEMPLATE_SHORTCUTS = (
  Object.entries(STRATEGY_PRESETS) as Array<[StrategyPresetKey, (typeof STRATEGY_PRESETS)[StrategyPresetKey]]>
).map(([key, preset]) => ({
  key,
  label: preset.label,
  description: preset.description,
}));

const sanitizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const dedupeSymbols = (symbols: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const symbol of symbols) {
    const normalized = sanitizeSymbol(symbol);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
};

export const normalizeSymbolShortcut = sanitizeSymbol;

export const loadRecentSymbols = (storage: StorageLike | null | undefined) => {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(RECENT_SYMBOLS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return dedupeSymbols(parsed.filter((symbol): symbol is string => typeof symbol === 'string'));
  } catch {
    return [];
  }
};

export const saveRecentSymbols = (storage: StorageLike | null | undefined, symbols: string[]) => {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      RECENT_SYMBOLS_STORAGE_KEY,
      JSON.stringify(dedupeSymbols(symbols).slice(0, MAX_RECENT_SYMBOLS))
    );
  } catch {
    // Local storage is best-effort only.
  }
};

export const upsertRecentSymbol = (symbols: string[], symbol: string) => {
  const normalized = sanitizeSymbol(symbol);
  if (!normalized) {
    return dedupeSymbols(symbols);
  }

  return dedupeSymbols([normalized, ...symbols]).slice(0, MAX_RECENT_SYMBOLS);
};

const clamp = (value: number, min: number) => Math.max(min, Math.round(value));

export function buildDefaultBacktestParameterSets(strategy: Pick<StrategyConfig, 'name' | 'parameters'>) {
  const parameters = strategy.parameters ?? {};
  const shortPeriod = Number(parameters.short_period ?? 5);
  const longPeriod = Number(parameters.long_period ?? 20);
  const period = Number(parameters.period ?? 14);
  const fastPeriod = Number(parameters.fast_period ?? 12);
  const slowPeriod = Number(parameters.slow_period ?? 26);
  const signalPeriod = Number(parameters.signal_period ?? 9);
  const stdDev = Number(parameters.std_dev ?? 2);
  const lookbackPeriod = Number(parameters.lookback_period ?? 20);
  const threshold = Number(parameters.threshold ?? 2);

  switch (strategy.name.trim().toLowerCase()) {
    case 'simple_moving_average':
      return [
        { short_period: shortPeriod, long_period: longPeriod },
        { short_period: clamp(shortPeriod + 2, 1), long_period: clamp(longPeriod + 5, shortPeriod + 3) },
      ];
    case 'rsi':
      return [
        { period, oversold: 30, overbought: 70 },
        { period: clamp(period + 3, 2), oversold: 25, overbought: 75 },
      ];
    case 'macd':
      return [
        { fast_period: fastPeriod, slow_period: slowPeriod, signal_period: signalPeriod },
        {
          fast_period: clamp(fastPeriod + 2, 1),
          slow_period: clamp(slowPeriod + 4, fastPeriod + 3),
          signal_period: clamp(signalPeriod + 1, 1),
        },
      ];
    case 'bollinger_bands':
      return [
        { period, std_dev: stdDev },
        { period: clamp(period + 5, 2), std_dev: Number((stdDev + 0.5).toFixed(1)) },
      ];
    case 'mean_reversion':
      return [
        { lookback_period: lookbackPeriod, threshold },
        {
          lookback_period: clamp(lookbackPeriod + 5, 2),
          threshold: Number((threshold + 0.5).toFixed(1)),
        },
      ];
    default:
      return [
        {},
        {},
      ];
  }
}

export function serializeBacktestParameterSets(parameterSets: Array<Record<string, unknown>>) {
  return JSON.stringify(parameterSets, null, 2);
}

export function parseBacktestParameterSets(input: string): {
  parameterSets: Array<Record<string, unknown>>;
  error?: string;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    return { parameterSets: [], error: '请至少提供 2 组参数覆盖。' };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return { parameterSets: [], error: '批量参数必须是 JSON 数组。' };
    }
    if (parsed.length < 2 || parsed.length > 5) {
      return { parameterSets: [], error: '批量实验必须包含 2 到 5 组参数。' };
    }

    const parameterSets = parsed.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`第 ${index + 1} 组参数必须是对象。`);
      }

      return item as Record<string, unknown>;
    });

    return { parameterSets };
  } catch (error) {
    return {
      parameterSets: [],
      error: error instanceof Error ? error.message : '批量参数 JSON 无法解析。',
    };
  }
}
