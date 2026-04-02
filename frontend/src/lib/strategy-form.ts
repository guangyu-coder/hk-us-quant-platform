import type { RiskLimits, StrategyConfig } from '@/types';

export type StrategyPresetKey =
  | 'simple_moving_average'
  | 'rsi'
  | 'macd'
  | 'bollinger_bands'
  | 'mean_reversion';

export type SearchResult = {
  symbol: string;
  instrument_name: string;
  exchange: string;
  country: string;
  instrument_type: string;
};

export type StrategyPresetDefinition = {
  label: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type StrategyFormState = {
  name: StrategyPresetKey;
  display_name: string;
  description: string;
  parameters: Record<string, unknown>;
  risk_limits: RiskLimits;
  is_active: boolean;
};

export const STRATEGY_PRESETS = {
  simple_moving_average: {
    label: 'SMA 双均线',
    description: '短均线上穿长均线买入，下穿卖出。',
    parameters: {
      symbol: 'AAPL',
      timeframe: '1d',
      initial_capital: 100000,
      fee_bps: 5,
      slippage_bps: 2,
      max_position_fraction: 1,
      short_period: 5,
      long_period: 20,
    },
  },
  rsi: {
    label: 'RSI 反转',
    description: '超卖买入，超买卖出。',
    parameters: {
      symbol: 'AAPL',
      timeframe: '1d',
      initial_capital: 100000,
      fee_bps: 5,
      slippage_bps: 2,
      max_position_fraction: 1,
      period: 14,
      oversold: 30,
      overbought: 70,
    },
  },
  macd: {
    label: 'MACD 趋势',
    description: '柱状图穿越零轴触发交易。',
    parameters: {
      symbol: 'AAPL',
      timeframe: '1d',
      initial_capital: 100000,
      fee_bps: 5,
      slippage_bps: 2,
      max_position_fraction: 1,
      fast_period: 12,
      slow_period: 26,
      signal_period: 9,
    },
  },
  bollinger_bands: {
    label: '布林带均值回归',
    description: '价格触碰下轨买入，上轨卖出。',
    parameters: {
      symbol: 'AAPL',
      timeframe: '1d',
      initial_capital: 100000,
      fee_bps: 5,
      slippage_bps: 2,
      max_position_fraction: 1,
      period: 20,
      std_dev: 2.0,
    },
  },
  mean_reversion: {
    label: '均值回归',
    description: '基于 z-score 偏离度的回归策略。',
    parameters: {
      symbol: 'AAPL',
      timeframe: '1d',
      initial_capital: 100000,
      fee_bps: 5,
      slippage_bps: 2,
      max_position_fraction: 1,
      lookback_period: 20,
      threshold: 2.0,
    },
  },
} as const satisfies Record<StrategyPresetKey, StrategyPresetDefinition>;

export const DEFAULT_STRATEGY_TYPE: StrategyPresetKey = 'simple_moving_average';

export const formatStrategyType = (name: string) =>
  STRATEGY_PRESETS[name as StrategyPresetKey]?.label ?? name;

export const getDefaultDisplayName = (name: StrategyPresetKey) =>
  STRATEGY_PRESETS[name].label;

export const getStrategyDisplayName = (
  strategy: Pick<StrategyConfig, 'name' | 'display_name'>
) => strategy.display_name?.trim() || formatStrategyType(strategy.name);

export const normalizeSearchSymbol = (result: Pick<SearchResult, 'symbol' | 'exchange' | 'country'>) => {
  const rawSymbol = result.symbol.trim().toUpperCase();
  const exchange = result.exchange.trim().toUpperCase();
  const country = result.country.trim().toUpperCase();

  if (rawSymbol.endsWith('.HK')) {
    return rawSymbol;
  }

  const isHongKong =
    country.includes('HONG KONG') ||
    exchange.includes('HK') ||
    exchange.includes('HONG KONG');

  if (isHongKong && /^\d+$/.test(rawSymbol)) {
    const normalizedCode = rawSymbol.length >= 4 ? rawSymbol : rawSymbol.padStart(4, '0');
    return `${normalizedCode}.HK`;
  }

  return rawSymbol;
};

export const inferStrategyPreset = (
  strategy: Pick<StrategyConfig, 'name' | 'parameters'>
): StrategyPresetKey => {
  const normalizedName = strategy.name.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalizedName in STRATEGY_PRESETS) {
    return normalizedName as StrategyPresetKey;
  }

  const parameters = strategy.parameters ?? {};
  if ('short_period' in parameters && 'long_period' in parameters) {
    return 'simple_moving_average';
  }
  if ('oversold' in parameters && 'overbought' in parameters) {
    return 'rsi';
  }
  if ('fast_period' in parameters && 'slow_period' in parameters && 'signal_period' in parameters) {
    return 'macd';
  }
  if ('std_dev' in parameters) {
    return 'bollinger_bands';
  }
  if ('lookback_period' in parameters && 'threshold' in parameters) {
    return 'mean_reversion';
  }

  return DEFAULT_STRATEGY_TYPE;
};

export const validateStrategyForm = (
  name: StrategyPresetKey,
  parameters: Record<string, unknown>
) => {
  const symbol = String(parameters.symbol ?? '').trim();
  const timeframe = String(parameters.timeframe ?? '').trim();
  const initialCapital = Number(parameters.initial_capital ?? 0);

  if (!symbol) {
    return '交易标的不能为空';
  }
  if (!['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo'].includes(timeframe)) {
    return '周期必须是 1m / 5m / 15m / 30m / 1h / 1d / 1wk / 1mo';
  }
  if (!Number.isFinite(initialCapital) || initialCapital < 100) {
    return '初始资金必须大于等于 100';
  }
  const feeBps = Number(parameters.fee_bps ?? 0);
  const slippageBps = Number(parameters.slippage_bps ?? 0);
  const maxPositionFraction = Number(parameters.max_position_fraction ?? 0);
  if (feeBps < 0 || feeBps > 1000 || slippageBps < 0 || slippageBps > 1000) {
    return '手续费和滑点必须在 0 到 1000 bps 之间';
  }
  if (!Number.isFinite(maxPositionFraction) || maxPositionFraction <= 0 || maxPositionFraction > 1) {
    return '最大仓位占比必须在 0 到 1 之间';
  }

  switch (name) {
    case 'simple_moving_average': {
      const shortPeriod = Number(parameters.short_period ?? 0);
      const longPeriod = Number(parameters.long_period ?? 0);
      if (shortPeriod < 1 || longPeriod < 2 || shortPeriod >= longPeriod) {
        return '短周期必须小于长周期，且二者都必须大于 0';
      }
      return null;
    }
    case 'rsi': {
      const period = Number(parameters.period ?? 0);
      const oversold = Number(parameters.oversold ?? 0);
      const overbought = Number(parameters.overbought ?? 0);
      if (period < 2) {
        return 'RSI 周期必须大于等于 2';
      }
      if (oversold < 0 || overbought > 100 || oversold >= overbought) {
        return 'RSI 超卖阈值必须小于超买阈值，且范围在 0 到 100 之间';
      }
      return null;
    }
    case 'macd': {
      const fastPeriod = Number(parameters.fast_period ?? 0);
      const slowPeriod = Number(parameters.slow_period ?? 0);
      const signalPeriod = Number(parameters.signal_period ?? 0);
      if (fastPeriod < 1 || slowPeriod < 2 || fastPeriod >= slowPeriod) {
        return 'MACD 快线周期必须小于慢线周期';
      }
      if (signalPeriod < 1 || signalPeriod >= slowPeriod) {
        return 'MACD 信号线周期必须小于慢线周期';
      }
      return null;
    }
    case 'bollinger_bands': {
      const period = Number(parameters.period ?? 0);
      const stdDev = Number(parameters.std_dev ?? 0);
      if (period < 2 || stdDev <= 0) {
        return '布林带周期必须大于等于 2，标准差倍数必须大于 0';
      }
      return null;
    }
    case 'mean_reversion': {
      const lookback = Number(parameters.lookback_period ?? 0);
      const threshold = Number(parameters.threshold ?? 0);
      if (lookback < 2 || threshold <= 0) {
        return '均值回归回看周期必须大于等于 2，阈值必须大于 0';
      }
      return null;
    }
  }
};

export const createStrategyFormState = (
  presetName: StrategyPresetKey = DEFAULT_STRATEGY_TYPE
): StrategyFormState => ({
  name: presetName,
  display_name: getDefaultDisplayName(presetName),
  description: STRATEGY_PRESETS[presetName].description,
  parameters: { ...STRATEGY_PRESETS[presetName].parameters },
  risk_limits: {},
  is_active: true,
});

export const buildStrategyFormStateFromStrategy = (
  strategy: Pick<StrategyConfig, 'name' | 'display_name' | 'description' | 'parameters' | 'risk_limits' | 'is_active'>
): StrategyFormState => {
  const presetName = inferStrategyPreset(strategy);
  return {
    name: presetName,
    display_name: strategy.display_name?.trim() || getDefaultDisplayName(presetName),
    description: strategy.description ?? '',
    parameters: {
      ...STRATEGY_PRESETS[presetName].parameters,
      ...(strategy.parameters ?? {}),
    },
    risk_limits: strategy.risk_limits || {},
    is_active: strategy.is_active,
  };
};

export const updateStrategyFormPreset = (
  form: StrategyFormState,
  nextType: StrategyPresetKey,
  preserveCommonFields: boolean
) => {
  const currentPresetName = form.name;
  const nextPreset = STRATEGY_PRESETS[nextType];
  const shouldResetDisplayName = !form.display_name.trim() || form.display_name.trim() === getDefaultDisplayName(currentPresetName);
  const shouldResetDescription = preserveCommonFields
    ? form.description.trim() === STRATEGY_PRESETS[currentPresetName].description
    : !form.description.trim() || form.description.trim() === STRATEGY_PRESETS[currentPresetName].description;

  const nextParameters = preserveCommonFields
    ? {
        ...STRATEGY_PRESETS[nextType].parameters,
        symbol: form.parameters.symbol ?? nextPreset.parameters.symbol,
        timeframe: form.parameters.timeframe ?? nextPreset.parameters.timeframe,
        initial_capital: form.parameters.initial_capital ?? nextPreset.parameters.initial_capital,
        fee_bps: form.parameters.fee_bps ?? nextPreset.parameters.fee_bps,
        slippage_bps: form.parameters.slippage_bps ?? nextPreset.parameters.slippage_bps,
        max_position_fraction:
          form.parameters.max_position_fraction ?? nextPreset.parameters.max_position_fraction,
      }
    : { ...STRATEGY_PRESETS[nextType].parameters };

  return {
    ...form,
    name: nextType,
    display_name: shouldResetDisplayName ? nextPreset.label : form.display_name,
    description: shouldResetDescription ? nextPreset.description : form.description,
    parameters: nextParameters,
  };
};
