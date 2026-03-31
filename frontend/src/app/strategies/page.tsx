'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { marketDataApi, strategyApi } from '@/lib/api';
import type { RiskLimits, StrategyConfig } from '@/types';
import { Plus, Play, Trash2, BarChart, Edit, Search, Loader2 } from 'lucide-react';

type StrategyFieldType = 'text' | 'number' | 'select';

type StrategyField = {
  key: string;
  label: string;
  type: StrategyFieldType;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
};

type StrategyPresetKey = keyof typeof STRATEGY_PRESETS;

type SearchResult = {
  symbol: string;
  instrument_name: string;
  exchange: string;
  country: string;
  instrument_type: string;
};

const STRATEGY_PRESETS = {
  simple_moving_average: {
    label: 'SMA 双均线',
    description: '短均线上穿长均线买入，下穿卖出。',
    parameters: { symbol: 'AAPL', timeframe: '1d', initial_capital: 100000, fee_bps: 5, slippage_bps: 2, max_position_fraction: 1, short_period: 5, long_period: 20 },
  },
  rsi: {
    label: 'RSI 反转',
    description: '超卖买入，超买卖出。',
    parameters: { symbol: 'AAPL', timeframe: '1d', initial_capital: 100000, fee_bps: 5, slippage_bps: 2, max_position_fraction: 1, period: 14, oversold: 30, overbought: 70 },
  },
  macd: {
    label: 'MACD 趋势',
    description: '柱状图穿越零轴触发交易。',
    parameters: { symbol: 'AAPL', timeframe: '1d', initial_capital: 100000, fee_bps: 5, slippage_bps: 2, max_position_fraction: 1, fast_period: 12, slow_period: 26, signal_period: 9 },
  },
  bollinger_bands: {
    label: '布林带均值回归',
    description: '价格触碰下轨买入，上轨卖出。',
    parameters: { symbol: 'AAPL', timeframe: '1d', initial_capital: 100000, fee_bps: 5, slippage_bps: 2, max_position_fraction: 1, period: 20, std_dev: 2.0 },
  },
  mean_reversion: {
    label: '均值回归',
    description: '基于 z-score 偏离度的回归策略。',
    parameters: { symbol: 'AAPL', timeframe: '1d', initial_capital: 100000, fee_bps: 5, slippage_bps: 2, max_position_fraction: 1, lookback_period: 20, threshold: 2.0 },
  },
} as const;

const COMMON_FIELDS: StrategyField[] = [
  { key: 'symbol', label: '交易标的', type: 'text', placeholder: 'AAPL' },
  {
    key: 'timeframe',
    label: '周期',
    type: 'select',
    options: [
      { label: '1 分钟', value: '1m' },
      { label: '5 分钟', value: '5m' },
      { label: '15 分钟', value: '15m' },
      { label: '30 分钟', value: '30m' },
      { label: '1 小时', value: '1h' },
      { label: '1 天', value: '1d' },
      { label: '1 周', value: '1wk' },
      { label: '1 月', value: '1mo' },
    ],
  },
  { key: 'initial_capital', label: '初始资金', type: 'number', min: 100, step: 1000 },
  { key: 'fee_bps', label: '手续费(bps)', type: 'number', min: 0, max: 1000, step: 1 },
  { key: 'slippage_bps', label: '滑点(bps)', type: 'number', min: 0, max: 1000, step: 1 },
  { key: 'max_position_fraction', label: '最大仓位占比', type: 'number', min: 0.01, max: 1, step: 0.05 },
];

const STRATEGY_FIELDS: Record<keyof typeof STRATEGY_PRESETS, StrategyField[]> = {
  simple_moving_average: [
    { key: 'short_period', label: '短周期', type: 'number', min: 1, step: 1 },
    { key: 'long_period', label: '长周期', type: 'number', min: 2, step: 1 },
  ],
  rsi: [
    { key: 'period', label: 'RSI 周期', type: 'number', min: 2, step: 1 },
    { key: 'oversold', label: '超卖阈值', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'overbought', label: '超买阈值', type: 'number', min: 0, max: 100, step: 1 },
  ],
  macd: [
    { key: 'fast_period', label: '快线周期', type: 'number', min: 1, step: 1 },
    { key: 'slow_period', label: '慢线周期', type: 'number', min: 2, step: 1 },
    { key: 'signal_period', label: '信号线周期', type: 'number', min: 1, step: 1 },
  ],
  bollinger_bands: [
    { key: 'period', label: '布林周期', type: 'number', min: 2, step: 1 },
    { key: 'std_dev', label: '标准差倍数', type: 'number', min: 0.1, step: 0.1 },
  ],
  mean_reversion: [
    { key: 'lookback_period', label: '回看周期', type: 'number', min: 2, step: 1 },
    { key: 'threshold', label: '偏离阈值', type: 'number', min: 0.1, step: 0.1 },
  ],
};

const DEFAULT_STRATEGY_TYPE: StrategyPresetKey = 'simple_moving_average';

const formatStrategyType = (name: string) =>
  STRATEGY_PRESETS[name as StrategyPresetKey]?.label ?? name;

const normalizeSearchSymbol = (result: SearchResult): string => {
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

const getStrategyDisplayName = (strategy: Pick<StrategyConfig, 'name' | 'display_name'>) =>
  strategy.display_name?.trim() || formatStrategyType(strategy.name);

const getPresetFields = (name: string) => {
  const presetName = name as StrategyPresetKey;
  return [...COMMON_FIELDS, ...(STRATEGY_FIELDS[presetName] ?? [])];
};

const inferStrategyPreset = (
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

const validateStrategyForm = (
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

const createStrategyFormState = (
  presetName: StrategyPresetKey = DEFAULT_STRATEGY_TYPE
) => ({
  name: presetName,
  display_name: STRATEGY_PRESETS[presetName].label,
  description: STRATEGY_PRESETS[presetName].description,
  parameters: { ...STRATEGY_PRESETS[presetName].parameters },
  risk_limits: {},
  is_active: true,
});

export default function StrategiesPage() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showBacktestModal, setShowBacktestModal] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyConfig | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [strategyForm, setStrategyForm] = useState<{
    name: StrategyPresetKey;
    display_name: string;
    description: string;
    parameters: Record<string, unknown>;
    risk_limits: RiskLimits;
    is_active: boolean;
  }>(createStrategyFormState());
  const [backtestParams, setBacktestParams] = useState({
    start_date: '',
    end_date: '',
  });
  const [symbolSearchQuery, setSymbolSearchQuery] = useState('');
  const [symbolSearchResults, setSymbolSearchResults] = useState<SearchResult[]>([]);
  const [showSymbolResults, setShowSymbolResults] = useState(false);
  const [symbolSearchLoading, setSymbolSearchLoading] = useState(false);
  const symbolSearchRef = useRef<HTMLDivElement | null>(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        symbolSearchRef.current &&
        event.target instanceof Node &&
        !symbolSearchRef.current.contains(event.target)
      ) {
        setShowSymbolResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const query = symbolSearchQuery.trim();
    if (query.length < 2) {
      setSymbolSearchResults([]);
      setSymbolSearchLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSymbolSearchLoading(true);
      try {
        const response = await marketDataApi.searchSymbols(query);
        const results = Array.isArray(response?.data) ? response.data : [];
        setSymbolSearchResults(results);
        setShowSymbolResults(true);
      } catch (error) {
        console.error('Failed to search symbols:', error);
        setSymbolSearchResults([]);
      } finally {
        setSymbolSearchLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [symbolSearchQuery]);

  const { data: strategies, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: async () => {
      try {
        const result = await strategyApi.getStrategies();
        return result as StrategyConfig[];
      } catch (error) {
        console.error('Failed to fetch strategies:', error);
        return [];
      }
    },
    refetchInterval: 10000,
  });

  const createStrategyMutation = useMutation({
    mutationFn: strategyApi.createStrategy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setShowCreateForm(false);
      setFormError(null);
      setStrategyForm(createStrategyFormState());
    },
    onError: (error) => {
      if (axios.isAxiosError(error)) {
        setFormError(error.response?.data?.error?.message ?? '创建策略失败');
        return;
      }
      setFormError('创建策略失败');
    },
  });

  const updateStrategyMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<StrategyConfig> }) =>
      strategyApi.updateStrategy(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setShowEditForm(false);
      setSelectedStrategy(null);
      setFormError(null);
      setStrategyForm(createStrategyFormState());
    },
    onError: (error) => {
      if (axios.isAxiosError(error)) {
        setFormError(error.response?.data?.error?.message ?? '更新策略失败');
        return;
      }
      setFormError('更新策略失败');
    },
  });

  const deleteStrategyMutation = useMutation({
    mutationFn: strategyApi.deleteStrategy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
  });

  const runBacktestMutation = useMutation({
    mutationFn: ({ strategyId, startDate, endDate }: { strategyId: string; startDate: string; endDate: string }) =>
      strategyApi.runBacktest(strategyId, startDate, endDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backtest-history'] });
      setShowBacktestModal(false);
      alert('回测已完成，结果已写入历史记录');
    },
  });

  const handleCreateStrategy = (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateStrategyForm(
      strategyForm.name as keyof typeof STRATEGY_PRESETS,
      strategyForm.parameters
    );
    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (!strategyForm.display_name.trim()) {
      setFormError('策略名称不能为空');
      return;
    }

    setFormError(null);
    createStrategyMutation.mutate({
      ...strategyForm,
      name: strategyForm.name,
      display_name: strategyForm.display_name.trim(),
    });
  };

  const handleDeleteStrategy = (strategy: StrategyConfig) => {
    const strategyName = getStrategyDisplayName(strategy);
    const confirmed = confirm(
      `确定要删除策略“${strategyName}”吗？\n\n此操作会同时删除该策略关联的订单、成交、回测记录和绩效数据，且无法恢复。`
    );

    if (confirmed) {
      deleteStrategyMutation.mutate(strategy.id);
    }
  };

  const handleToggleStrategy = (strategy: StrategyConfig) => {
    updateStrategyMutation.mutate({
      id: strategy.id,
      data: { is_active: !strategy.is_active },
    });
  };

  const handleEditStrategy = (strategy: StrategyConfig) => {
    setSelectedStrategy(strategy);
    setFormError(null);
    const presetName = inferStrategyPreset(strategy);
    const presetParameters = STRATEGY_PRESETS[presetName].parameters;

    setStrategyForm({
      name: presetName,
      display_name: strategy.display_name || '',
      description: strategy.description || '',
      parameters: {
        ...presetParameters,
        ...(strategy.parameters || {}),
      },
      risk_limits: strategy.risk_limits || {},
      is_active: strategy.is_active,
    });

    setShowEditForm(true);
  };

  const handleUpdateStrategy = (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateStrategyForm(
      strategyForm.name as keyof typeof STRATEGY_PRESETS,
      strategyForm.parameters
    );
    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (!strategyForm.display_name.trim()) {
      setFormError('策略名称不能为空');
      return;
    }

    if (!selectedStrategy) {
      setFormError('未选择策略');
      return;
    }

    setFormError(null);
    updateStrategyMutation.mutate({
      id: selectedStrategy.id,
      data: {
        name: strategyForm.name,
        display_name: strategyForm.display_name.trim(),
        description: strategyForm.description,
        parameters: strategyForm.parameters,
        risk_limits: strategyForm.risk_limits,
        is_active: strategyForm.is_active,
      },
    });
  };

  const handleRunBacktest = (strategy: StrategyConfig) => {
    setSelectedStrategy(strategy);
    setShowBacktestModal(true);
  };

  const handleSubmitBacktest = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStrategy) {
      runBacktestMutation.mutate({
        strategyId: selectedStrategy.id,
        startDate: backtestParams.start_date,
        endDate: backtestParams.end_date,
      });
    }
  };

  // 确保strategies是数组
  const strategiesArray = Array.isArray(strategies) ? strategies : 
                          ((strategies as any)?.strategies ? (strategies as any).strategies : []);
  
  // 计算统计数据
  const totalCount = strategiesArray.length;
  const activeCount = strategiesArray.filter((s: StrategyConfig) => s.is_active).length;
  const inactiveCount = totalCount - activeCount;

  const getStatusColor = (isActive: boolean) => {
    return isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
  };

  const getStatusText = (isActive: boolean) => {
    return isActive ? '运行中' : '已停止';
  };

  const renderFieldInput = (field: StrategyField) => {
    const rawValue = strategyForm.parameters[field.key];
    const value = field.type === 'number'
      ? typeof rawValue === 'number'
        ? rawValue
        : Number(rawValue ?? 0)
      : String(rawValue ?? '');

    if (field.key === 'symbol') {
      return (
        <div key={field.key} ref={symbolSearchRef} className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="输入代码或名称，例如 AAPL / 腾讯"
              value={String(rawValue ?? '')}
              onFocus={() => {
                setSymbolSearchQuery(String(rawValue ?? ''));
                if (symbolSearchResults.length > 0) {
                  setShowSymbolResults(true);
                }
              }}
              onChange={(e) => {
                const nextValue = e.target.value.toUpperCase();
                setStrategyForm({
                  ...strategyForm,
                  parameters: {
                    ...strategyForm.parameters,
                    symbol: nextValue,
                  },
                });
                setSymbolSearchQuery(e.target.value);
                setShowSymbolResults(true);
              }}
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-10"
            />
            {symbolSearchLoading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-blue-500" />
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            支持输入股票代码或名称搜索，未命中时也可手动输入自定义代码。
          </p>

          {showSymbolResults && (
            <div className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {symbolSearchResults.length > 0 ? (
                symbolSearchResults.slice(0, 12).map((result) => {
                  const normalizedSymbol = normalizeSearchSymbol(result);
                  return (
                    <button
                      key={`${result.symbol}-${result.exchange}-${result.country}`}
                      type="button"
                      onClick={() => {
                        setStrategyForm({
                          ...strategyForm,
                          parameters: {
                            ...strategyForm.parameters,
                            symbol: normalizedSymbol,
                          },
                        });
                        setSymbolSearchQuery(normalizedSymbol);
                        setShowSymbolResults(false);
                      }}
                      className="block w-full border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-blue-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-gray-900">{normalizedSymbol}</div>
                          <div className="text-sm text-gray-500">
                            {result.instrument_name || '未知名称'}
                          </div>
                        </div>
                        <div className="text-right text-xs text-gray-500">
                          <div>{result.exchange || '-'}</div>
                          <div>{result.instrument_type || '-'}</div>
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-3 text-sm text-gray-500">
                  未找到匹配标的，可以继续手动输入代码
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    if (field.type === 'select') {
      return (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {field.label}
          </label>
          <select
            value={String(rawValue ?? '')}
            onChange={(e) => {
              setStrategyForm({
                ...strategyForm,
                parameters: {
                  ...strategyForm.parameters,
                  [field.key]: e.target.value,
                },
              });
            }}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          >
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.value})
              </option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div key={field.key}>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {field.label}
        </label>
        <input
          type={field.type}
          min={field.min}
          max={field.max}
          step={field.step}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => {
            const nextValue = field.type === 'number'
              ? (e.target.value === '' ? '' : Number(e.target.value))
              : e.target.value;
            setStrategyForm({
              ...strategyForm,
              parameters: {
                ...strategyForm.parameters,
                [field.key]: nextValue,
              },
            });
          }}
          className="w-full border border-gray-300 rounded-md px-3 py-2"
        />
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">策略管理</h1>
        <button
          onClick={() => {
            setFormError(null);
            setStrategyForm(createStrategyFormState());
            setShowCreateForm(true);
          }}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          新建策略
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">策略列表</h3>
            </div>

            {isLoading ? (
              <div className="p-6">
                <div className="animate-pulse space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 bg-gray-200 rounded"></div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {strategiesArray.map((strategy: StrategyConfig) => (
                  <div key={strategy.id} className="p-6 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h4 className="text-lg font-medium text-gray-900">
                            {getStrategyDisplayName(strategy)}
                          </h4>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(strategy.is_active)}`}>
                            {getStatusText(strategy.is_active)}
                          </span>
                        </div>

                        {strategy.description && (
                          <p className="mt-2 text-sm text-gray-500">
                            {strategy.description}
                          </p>
                        )}

                        <div className="mt-3 flex items-center space-x-6 text-sm">
                          <div>
                            <span className="text-gray-500">参数数量:</span>
                            <span className="ml-1 font-medium text-gray-900">
                              {Object.keys(strategy.parameters || {}).length}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500">创建时间:</span>
                            <span className="ml-1 font-medium text-gray-900">
                              {new Date(strategy.created_at).toLocaleDateString('zh-CN')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleToggleStrategy(strategy)}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                          title={strategy.is_active ? '停止策略' : '启动策略'}
                        >
                          <Play className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleEditStrategy(strategy)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded"
                          title="编辑策略"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRunBacktest(strategy)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                          title="运行回测"
                        >
                          <BarChart className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteStrategy(strategy)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                          title="删除策略"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {strategiesArray.length === 0 && (
                  <div className="p-12 text-center text-sm text-gray-500">
                    暂无策略，点击&quot;新建策略&quot;开始创建
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">策略统计</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">总策略数</span>
                <span className="text-lg font-bold text-gray-900">
                  {totalCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">运行中</span>
                <span className="text-lg font-bold text-green-600">
                  {activeCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">已停止</span>
                <span className="text-lg font-bold text-gray-600">
                  {inactiveCount}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">快速操作</h3>
            <div className="space-y-3">
              <button
                onClick={() => setShowCreateForm(true)}
                className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                新建策略
              </button>
              <button className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                <BarChart className="h-4 w-4 mr-2" />
                批量回测
              </button>
            </div>
          </div>
        </div>
      </div>

      {showCreateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-medium">新建策略</h3>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateStrategy} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略类型
                </label>
                <select
                  value={strategyForm.name}
                  onChange={(e) => {
                    const nextType = e.target.value as StrategyPresetKey;
                    setFormError(null);
                    setStrategyForm({
                      ...strategyForm,
                      name: nextType,
                      display_name:
                        strategyForm.display_name || STRATEGY_PRESETS[nextType].label,
                      description: STRATEGY_PRESETS[nextType].description,
                      parameters: { ...STRATEGY_PRESETS[nextType].parameters },
                    });
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  {Object.entries(STRATEGY_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略名称
                </label>
                <input
                  type="text"
                  value={strategyForm.display_name}
                  onChange={(e) =>
                    setStrategyForm({ ...strategyForm, display_name: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="例如：美股双均线趋势策略"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略描述
                </label>
                <textarea
                  value={strategyForm.description}
                  onChange={(e) => setStrategyForm({ ...strategyForm, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  rows={3}
                  placeholder="描述策略的原理和使用方法..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  策略参数
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {getPresetFields(strategyForm.name).map(renderFieldInput)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  参数预览
                </label>
                <pre className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700 overflow-x-auto">
                  {JSON.stringify(strategyForm.parameters, null, 2)}
                </pre>
              </div>

              {formError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={strategyForm.is_active}
                  onChange={(e) => setStrategyForm({ ...strategyForm, is_active: e.target.checked })}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">
                  立即启用策略
                </label>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createStrategyMutation.isPending}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {createStrategyMutation.isPending ? '创建中...' : '创建策略'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditForm && selectedStrategy && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-medium">编辑策略</h3>
                <p className="mt-1 text-sm text-gray-500">
                  当前策略 ID: {selectedStrategy.id}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowEditForm(false);
                  setSelectedStrategy(null);
                  setFormError(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateStrategy} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略类型
                </label>
                <select
                  value={strategyForm.name}
                  onChange={(e) => {
                    const nextType = e.target.value as StrategyPresetKey;
                    setFormError(null);
                    setStrategyForm({
                      ...strategyForm,
                      name: nextType,
                      display_name:
                        strategyForm.display_name || STRATEGY_PRESETS[nextType].label,
                      parameters: {
                        ...STRATEGY_PRESETS[nextType].parameters,
                        symbol: strategyForm.parameters.symbol ?? STRATEGY_PRESETS[nextType].parameters.symbol,
                        timeframe: strategyForm.parameters.timeframe ?? STRATEGY_PRESETS[nextType].parameters.timeframe,
                        initial_capital: strategyForm.parameters.initial_capital ?? STRATEGY_PRESETS[nextType].parameters.initial_capital,
                        fee_bps: strategyForm.parameters.fee_bps ?? STRATEGY_PRESETS[nextType].parameters.fee_bps,
                        slippage_bps: strategyForm.parameters.slippage_bps ?? STRATEGY_PRESETS[nextType].parameters.slippage_bps,
                        max_position_fraction: strategyForm.parameters.max_position_fraction ?? STRATEGY_PRESETS[nextType].parameters.max_position_fraction,
                      },
                    });
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  {Object.entries(STRATEGY_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略名称
                </label>
                <input
                  type="text"
                  value={strategyForm.display_name}
                  onChange={(e) =>
                    setStrategyForm({ ...strategyForm, display_name: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="例如：美股双均线趋势策略"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略描述
                </label>
                <textarea
                  value={strategyForm.description}
                  onChange={(e) => setStrategyForm({ ...strategyForm, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  rows={3}
                  placeholder="描述策略的原理和使用方法..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  策略参数
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {getPresetFields(strategyForm.name).map(renderFieldInput)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  参数预览
                </label>
                <pre className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700 overflow-x-auto">
                  {JSON.stringify(strategyForm.parameters, null, 2)}
                </pre>
              </div>

              {formError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="edit_is_active"
                  checked={strategyForm.is_active}
                  onChange={(e) => setStrategyForm({ ...strategyForm, is_active: e.target.checked })}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="edit_is_active" className="ml-2 text-sm text-gray-700">
                  启用该策略
                </label>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditForm(false);
                    setSelectedStrategy(null);
                    setFormError(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={updateStrategyMutation.isPending}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateStrategyMutation.isPending ? '保存中...' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBacktestModal && selectedStrategy && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">运行回测</h3>
              <button
                onClick={() => setShowBacktestModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 mb-2">策略名称</p>
                <p className="font-medium text-gray-900">{getStrategyDisplayName(selectedStrategy)}</p>
              </div>

              <form onSubmit={handleSubmitBacktest} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    开始日期
                  </label>
                  <input
                    type="date"
                    value={backtestParams.start_date}
                    onChange={(e) => setBacktestParams({ ...backtestParams, start_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    结束日期
                  </label>
                  <input
                    type="date"
                    value={backtestParams.end_date}
                    onChange={(e) => setBacktestParams({ ...backtestParams, end_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowBacktestModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={runBacktestMutation.isPending}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {runBacktestMutation.isPending ? '运行中...' : '运行回测'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
