'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiErrorMessage, marketDataApi, strategyApi } from '@/lib/api';
import {
  STRATEGY_PRESETS,
  buildStrategyFormStateFromStrategy,
  createStrategyFormState,
  getStrategyDisplayName,
  normalizeSearchSymbol,
  updateStrategyFormPreset,
  validateStrategyForm,
} from '@/lib/strategy-form';
import type { RiskLimits, StrategyConfig } from '@/types';
import { Plus, Play, Trash2, BarChart, Edit, Search, Loader2, RotateCcw } from 'lucide-react';
import {
  buildCreateStrategyPayload,
  buildDeleteStrategyConfirmation,
  buildUpdateStrategyPayload,
  deriveStrategyCounts,
  normalizeStrategyCollection,
} from './strategy-page-helpers';
import {
  COMMON_SYMBOL_SHORTCUTS,
  STRATEGY_TEMPLATE_SHORTCUTS,
  buildDefaultBacktestParameterSets,
  loadRecentSymbols,
  normalizeSymbolShortcut,
  parseBacktestParameterSets,
  serializeBacktestParameterSets,
  saveRecentSymbols,
  upsertRecentSymbol,
} from './strategy-workflow';

type StrategyFieldType = 'text' | 'number' | 'select';

type StrategyField = {
  key: string;
  label: string;
  type: StrategyFieldType;
  helpText?: string;
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

const COMMON_FIELDS: StrategyField[] = [
  {
    key: 'symbol',
    label: '交易标的',
    type: 'text',
    placeholder: 'AAPL',
    helpText: '写入 parameters.symbol，回测和报告都会使用这个标的。',
  },
  {
    key: 'timeframe',
    label: '周期',
    type: 'select',
    helpText: '写入 parameters.timeframe，决定历史数据粒度和回测周期。',
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
  {
    key: 'initial_capital',
    label: '初始资金',
    type: 'number',
    min: 100,
    step: 1000,
    helpText: '回测起始资金，必须大于等于 100。',
  },
  {
    key: 'fee_bps',
    label: '手续费(bps)',
    type: 'number',
    min: 0,
    max: 1000,
    step: 1,
    helpText: '单边手续费，单位 bps，越高越保守。',
  },
  {
    key: 'slippage_bps',
    label: '滑点(bps)',
    type: 'number',
    min: 0,
    max: 1000,
    step: 1,
    helpText: '单边滑点，单位 bps，用于模拟成交偏差。',
  },
  {
    key: 'max_position_fraction',
    label: '最大仓位占比',
    type: 'number',
    min: 0.01,
    max: 1,
    step: 0.05,
    helpText: '单次允许投入的最大资金比例，1 表示可满仓。',
  },
];

const STRATEGY_FIELDS: Record<keyof typeof STRATEGY_PRESETS, StrategyField[]> = {
  simple_moving_average: [
    {
      key: 'short_period',
      label: '短周期',
      type: 'number',
      min: 1,
      step: 1,
      helpText: '短周期均线长度，必须小于长周期。',
    },
    {
      key: 'long_period',
      label: '长周期',
      type: 'number',
      min: 2,
      step: 1,
      helpText: '长周期均线长度，用于与短周期做交叉判断。',
    },
  ],
  rsi: [
    {
      key: 'period',
      label: 'RSI 周期',
      type: 'number',
      min: 2,
      step: 1,
      helpText: 'RSI 计算窗口，必须大于等于 2。',
    },
    {
      key: 'oversold',
      label: '超卖阈值',
      type: 'number',
      min: 0,
      max: 100,
      step: 1,
      helpText: '低于该值时视为超卖。',
    },
    {
      key: 'overbought',
      label: '超买阈值',
      type: 'number',
      min: 0,
      max: 100,
      step: 1,
      helpText: '高于该值时视为超买。',
    },
  ],
  macd: [
    {
      key: 'fast_period',
      label: '快线周期',
      type: 'number',
      min: 1,
      step: 1,
      helpText: 'MACD 快线长度，必须小于慢线周期。',
    },
    {
      key: 'slow_period',
      label: '慢线周期',
      type: 'number',
      min: 2,
      step: 1,
      helpText: 'MACD 慢线长度。',
    },
    {
      key: 'signal_period',
      label: '信号线周期',
      type: 'number',
      min: 1,
      step: 1,
      helpText: 'MACD 信号线长度，必须小于慢线周期。',
    },
  ],
  bollinger_bands: [
    {
      key: 'period',
      label: '布林周期',
      type: 'number',
      min: 2,
      step: 1,
      helpText: '布林带计算窗口，必须大于等于 2。',
    },
    {
      key: 'std_dev',
      label: '标准差倍数',
      type: 'number',
      min: 0.1,
      step: 0.1,
      helpText: '标准差倍率，越大越宽松。',
    },
  ],
  mean_reversion: [
    {
      key: 'lookback_period',
      label: '回看周期',
      type: 'number',
      min: 2,
      step: 1,
      helpText: '回看窗口，必须大于等于 2。',
    },
    {
      key: 'threshold',
      label: '偏离阈值',
      type: 'number',
      min: 0.1,
      step: 0.1,
      helpText: 'z-score 偏离阈值，越大触发越少。',
    },
  ],
};

const getPresetFields = (name: string) => {
  const presetName = name as StrategyPresetKey;
  return [...COMMON_FIELDS, ...(STRATEGY_FIELDS[presetName] ?? [])];
};

const formatBacktestSummaryValue = (value: unknown, suffix = '') => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value.toLocaleString('zh-CN')}${suffix}`;
  }

  if (typeof value === 'string' && value.trim()) {
    return `${value}${suffix}`;
  }

  return '-';
};

export default function StrategiesPage() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showBacktestModal, setShowBacktestModal] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyConfig | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestMode, setBacktestMode] = useState<'single' | 'batch'>('single');
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
  const [experimentLabel, setExperimentLabel] = useState('');
  const [experimentNote, setExperimentNote] = useState('');
  const [parameterVersion, setParameterVersion] = useState('');
  const [batchParameterSetsText, setBatchParameterSetsText] = useState('');
  const [symbolSearchQuery, setSymbolSearchQuery] = useState('');
  const [symbolSearchResults, setSymbolSearchResults] = useState<SearchResult[]>([]);
  const [showSymbolResults, setShowSymbolResults] = useState(false);
  const [symbolSearchLoading, setSymbolSearchLoading] = useState(false);
  const [recentSymbols, setRecentSymbols] = useState<string[]>([]);
  const symbolSearchRef = useRef<HTMLDivElement | null>(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setRecentSymbols(loadRecentSymbols(window.localStorage));
  }, []);

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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setShowCreateForm(false);
      setFormError(null);
      setDeleteError(null);
      const nextSymbol = normalizeSymbolShortcut(String(variables.parameters?.symbol ?? ''));
      if (nextSymbol) {
        setRecentSymbols((current) => {
          const next = upsertRecentSymbol(current, nextSymbol);
          if (typeof window !== 'undefined') {
            saveRecentSymbols(window.localStorage, next);
          }
          return next;
        });
      }
      setStrategyForm(createStrategyFormState());
    },
    onError: (error) => {
      setFormError(getApiErrorMessage(error, '创建策略失败'));
    },
  });

  const updateStrategyMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<StrategyConfig> }) =>
      strategyApi.updateStrategy(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setShowEditForm(false);
      setSelectedStrategy(null);
      setFormError(null);
      const nextSymbol = normalizeSymbolShortcut(String(variables.data.parameters?.symbol ?? ''));
      if (nextSymbol) {
        setRecentSymbols((current) => {
          const next = upsertRecentSymbol(current, nextSymbol);
          if (typeof window !== 'undefined') {
            saveRecentSymbols(window.localStorage, next);
          }
          return next;
        });
      }
      setStrategyForm(createStrategyFormState());
    },
    onError: (error) => {
      setFormError(getApiErrorMessage(error, '更新策略失败'));
    },
  });

  const deleteStrategyMutation = useMutation({
    mutationFn: strategyApi.deleteStrategy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setDeleteError(null);
    },
    onError: (error) => {
      setDeleteError(getApiErrorMessage(error, '删除策略失败'));
    },
  });

  const runBacktestMutation = useMutation({
    mutationFn: ({
      strategyId,
      startDate,
      endDate,
      experimentLabel,
      experimentNote,
      parameterVersion,
    }: {
      strategyId: string;
      startDate: string;
      endDate: string;
      experimentLabel?: string;
      experimentNote?: string;
      parameterVersion?: string;
    }) =>
      strategyApi.runBacktest(strategyId, startDate, endDate, {
        experiment_label: experimentLabel,
        experiment_note: experimentNote,
        parameter_version: parameterVersion,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backtest-history'] });
      setShowBacktestModal(false);
      resetBacktestForm();
      alert('回测已完成，结果已写入历史记录');
    },
    onError: (error) => {
      setBacktestError(getApiErrorMessage(error, '回测运行失败'));
    },
  });

  const runBacktestBatchMutation = useMutation({
    mutationFn: ({
      strategyId,
      startDate,
      endDate,
      experimentLabel,
      experimentNote,
      parameterVersion,
      parameterSets,
    }: {
      strategyId: string;
      startDate: string;
      endDate: string;
      experimentLabel?: string;
      experimentNote?: string;
      parameterVersion?: string;
      parameterSets: Array<Record<string, unknown>>;
    }) =>
      strategyApi.runBacktestBatch(strategyId, {
        start_date: startDate,
        end_date: endDate,
        experiment_label: experimentLabel,
        experiment_note: experimentNote,
        parameter_version: parameterVersion,
        parameter_sets: parameterSets,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['backtest-history'] });
      setShowBacktestModal(false);
      resetBacktestForm();
      alert(`实验批次已完成，共 ${data.count} 组回测结果`);
    },
    onError: (error) => {
      setBacktestError(getApiErrorMessage(error, '批量回测运行失败'));
    },
  });

  const handleCreateStrategy = (e: React.FormEvent) => {
    e.preventDefault();
    if (createStrategyMutation.isPending) {
      return;
    }

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
    createStrategyMutation.mutate(buildCreateStrategyPayload(strategyForm));
  };

  const rememberSymbolShortcut = (symbol: string) => {
    const normalized = normalizeSymbolShortcut(symbol);
    if (!normalized) {
      return;
    }

    setRecentSymbols((current) => {
      const next = upsertRecentSymbol(current, normalized);
      if (typeof window !== 'undefined') {
        saveRecentSymbols(window.localStorage, next);
      }
      return next;
    });
  };

  const handleDeleteStrategy = (strategy: StrategyConfig) => {
    if (deleteStrategyMutation.isPending) {
      return;
    }

    const confirmed = confirm(buildDeleteStrategyConfirmation(strategy));

    if (confirmed) {
      setDeleteError(null);
      deleteStrategyMutation.mutate(strategy.id);
    }
  };

  const handleToggleStrategy = (strategy: StrategyConfig) => {
    if (updateStrategyMutation.isPending) {
      return;
    }

    updateStrategyMutation.mutate({
      id: strategy.id,
      data: { is_active: !strategy.is_active },
    });
  };

  const handleEditStrategy = (strategy: StrategyConfig) => {
    setSelectedStrategy(strategy);
    setFormError(null);
    setStrategyForm(buildStrategyFormStateFromStrategy(strategy));

    setShowEditForm(true);
  };

  const handleUpdateStrategy = (e: React.FormEvent) => {
    e.preventDefault();
    if (updateStrategyMutation.isPending) {
      return;
    }

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
      data: buildUpdateStrategyPayload(strategyForm),
    });
  };

  const isBacktestSubmitting = runBacktestMutation.isPending || runBacktestBatchMutation.isPending;

  const initializeBacktestMetadata = (strategy: StrategyConfig) => {
    const experimentBaseName = getStrategyDisplayName(strategy);
    setExperimentLabel(`${experimentBaseName} 实验`);
    setExperimentNote(strategy.description?.trim() || '');
    setParameterVersion(`v${new Date().toISOString().slice(0, 10)}`);
  };

  const initializeBatchParameterSets = (strategy: StrategyConfig) => {
    setBatchParameterSetsText(
      serializeBacktestParameterSets(buildDefaultBacktestParameterSets(strategy))
    );
  };

  const handleRunBacktest = (strategy: StrategyConfig, mode: 'single' | 'batch' = 'single') => {
    if (isBacktestSubmitting) {
      return;
    }

    resetBacktestForm();
    setSelectedStrategy(strategy);
    setBacktestMode(mode);
    initializeBacktestMetadata(strategy);
    if (mode === 'batch') {
      initializeBatchParameterSets(strategy);
    }
    setShowBacktestModal(true);
  };

  const handleSubmitBacktest = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBacktestSubmitting) {
      return;
    }

    if (selectedStrategy) {
      setBacktestError(null);
      if (backtestMode === 'batch') {
        const parsed = parseBacktestParameterSets(batchParameterSetsText);
        if (parsed.error) {
          setBacktestError(parsed.error);
          return;
        }

        runBacktestBatchMutation.mutate({
          strategyId: selectedStrategy.id,
          startDate: backtestParams.start_date,
          endDate: backtestParams.end_date,
          experimentLabel: experimentLabel.trim() || undefined,
          experimentNote: experimentNote.trim() || undefined,
          parameterVersion: parameterVersion.trim() || undefined,
          parameterSets: parsed.parameterSets,
        });
        return;
      }

      runBacktestMutation.mutate({
        strategyId: selectedStrategy.id,
        startDate: backtestParams.start_date,
        endDate: backtestParams.end_date,
        experimentLabel: experimentLabel.trim() || undefined,
        experimentNote: experimentNote.trim() || undefined,
        parameterVersion: parameterVersion.trim() || undefined,
      });
    }
  };

  const handleResetCreateForm = () => {
    setFormError(null);
    setStrategyForm(createStrategyFormState(strategyForm.name));
  };

  const handleResetEditForm = () => {
    if (!selectedStrategy) {
      return;
    }

    setFormError(null);
    setStrategyForm(buildStrategyFormStateFromStrategy(selectedStrategy));
  };

  const resetBacktestForm = () => {
    setBacktestError(null);
    setBacktestParams({ start_date: '', end_date: '' });
    setBacktestMode('single');
    setExperimentLabel('');
    setExperimentNote('');
    setParameterVersion('');
    setBatchParameterSetsText('');
  };

  const openCreateStrategyForm = (presetName: StrategyPresetKey = 'simple_moving_average') => {
    setFormError(null);
    setDeleteError(null);
    setBacktestError(null);
    setStrategyForm(createStrategyFormState(presetName));
    setShowCreateForm(true);
  };

  const strategiesArray = useMemo(() => normalizeStrategyCollection(strategies), [strategies]);
  
  const { totalCount, activeCount, inactiveCount } = deriveStrategyCounts(strategiesArray);

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
      const recentShortcutSymbols = recentSymbols.filter((symbol) => symbol !== String(rawValue ?? '').trim().toUpperCase());
      const commonShortcutSymbols = COMMON_SYMBOL_SHORTCUTS.filter(
        (symbol) =>
          symbol !== String(rawValue ?? '').trim().toUpperCase() &&
          !recentShortcutSymbols.includes(symbol)
      );

      const applySymbol = (nextSymbol: string) => {
        const normalizedSymbol = normalizeSymbolShortcut(nextSymbol);
        setFormError(null);
        setStrategyForm({
          ...strategyForm,
          parameters: {
            ...strategyForm.parameters,
            symbol: normalizedSymbol,
          },
        });
        setSymbolSearchQuery(normalizedSymbol);
        setShowSymbolResults(false);
        rememberSymbolShortcut(normalizedSymbol);
      };

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
                setFormError(null);
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
            {field.helpText ?? '支持输入股票代码或名称搜索，未命中时也可手动输入自定义代码。'}
          </p>

          <div className="mt-3 space-y-3">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                最近使用
              </div>
              <div className="flex flex-wrap gap-2">
                {recentShortcutSymbols.length > 0 ? (
                  recentShortcutSymbols.slice(0, 4).map((symbol) => (
                    <button
                      key={symbol}
                      type="button"
                      onClick={() => applySymbol(symbol)}
                      className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
                    >
                      {symbol}
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-gray-400">保存成功后会出现在这里</span>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                常用标的
              </div>
              <div className="flex flex-wrap gap-2">
                {commonShortcutSymbols.slice(0, 6).map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => applySymbol(symbol)}
                    className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:border-blue-300 hover:bg-blue-50"
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </div>
          </div>

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
                        applySymbol(normalizedSymbol);
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
              setFormError(null);
            }}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          >
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.value})
              </option>
            ))}
          </select>
          {field.helpText && (
            <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
          )}
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
            setFormError(null);
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
        {field.helpText && (
          <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">策略管理</h1>
        <button
          onClick={() => openCreateStrategyForm()}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          新建策略
        </button>
      </div>

      {deleteError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {deleteError}
        </div>
      )}

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

                        <div className="mt-2 text-xs text-gray-500">
                          <span className="font-medium text-gray-700">name:</span> {strategy.name}
                          <span className="mx-2">·</span>
                          <span className="font-medium text-gray-700">display_name:</span> {getStrategyDisplayName(strategy)}
                          <span className="mx-2">·</span>
                          <span className="font-medium text-gray-700">symbol:</span> {String(strategy.parameters?.symbol ?? '-')}
                          <span className="mx-2">·</span>
                          <span className="font-medium text-gray-700">timeframe:</span> {String(strategy.parameters?.timeframe ?? '-')}
                        </div>

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
                          disabled={updateStrategyMutation.isPending}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded disabled:cursor-not-allowed disabled:opacity-50"
                          title={strategy.is_active ? '停止策略' : '启动策略'}
                        >
                          <Play className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleEditStrategy(strategy)}
                          disabled={createStrategyMutation.isPending || updateStrategyMutation.isPending}
                          className="p-2 text-green-600 hover:bg-green-50 rounded disabled:cursor-not-allowed disabled:opacity-50"
                          title="编辑策略"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRunBacktest(strategy)}
                          disabled={runBacktestMutation.isPending}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded disabled:cursor-not-allowed disabled:opacity-50"
                          title="运行回测"
                        >
                          <BarChart className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteStrategy(strategy)}
                          disabled={deleteStrategyMutation.isPending}
                          className="p-2 text-red-600 hover:bg-red-50 rounded disabled:cursor-not-allowed disabled:opacity-50"
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
                onClick={() => openCreateStrategyForm()}
                className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                新建策略
              </button>
              <button
                type="button"
                onClick={() => {
                  if (strategiesArray.length === 1) {
                    handleRunBacktest(strategiesArray[0], 'batch');
                    return;
                  }

                  alert('请先从具体策略卡片进入回测弹窗，再切换到批量模式。');
                }}
                disabled={strategiesArray.length === 0}
                className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <BarChart className="h-4 w-4 mr-2" />
                批量实验
              </button>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-2">模板起步</h3>
            <p className="mb-4 text-sm text-gray-500">
              从当前内置 preset 直接开题，适合做研究对比或快速试错。
            </p>
            <div className="space-y-3">
              {STRATEGY_TEMPLATE_SHORTCUTS.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => openCreateStrategyForm(template.key)}
                  className="w-full rounded-lg border border-gray-200 bg-gradient-to-r from-white to-slate-50 px-4 py-3 text-left transition hover:border-blue-300 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-gray-900">{template.label}</span>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                      立即开始
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{template.description}</p>
                </button>
              ))}
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
                  策略类型 name
                </label>
                <select
                  value={strategyForm.name}
                  onChange={(e) => {
                    const nextType = e.target.value as StrategyPresetKey;
                    setFormError(null);
                    setStrategyForm(updateStrategyFormPreset(strategyForm, nextType, false));
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  {Object.entries(STRATEGY_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  这是内部策略类型 key，不是界面展示名称。切换类型会重置该类型的默认参数。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  展示名称 display_name
                </label>
                <input
                  type="text"
                  value={strategyForm.display_name}
                  onChange={(e) => {
                    setFormError(null);
                    setStrategyForm({ ...strategyForm, display_name: e.target.value });
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="例如：美股双均线趋势策略"
                />
                <p className="mt-1 text-xs text-gray-500">
                  仅用于界面展示与回测报告，内部策略类型请看上面的 name。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略描述
                </label>
                <textarea
                  value={strategyForm.description}
                  onChange={(e) => {
                    setFormError(null);
                    setStrategyForm({ ...strategyForm, description: e.target.value });
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  rows={3}
                  placeholder="描述策略的原理和使用方法..."
                />
                <p className="mt-1 text-xs text-gray-500">
                  描述会随策略保存，适合写清研究假设和使用限制。
                </p>
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
                  onChange={(e) => {
                    setFormError(null);
                    setStrategyForm({ ...strategyForm, is_active: e.target.checked });
                  }}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">
                  立即启用策略
                </label>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={handleResetCreateForm}
                  disabled={createStrategyMutation.isPending}
                  className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  恢复默认值
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  disabled={createStrategyMutation.isPending}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
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
                <p className="mt-1 text-xs text-gray-500">
                  name 是内部策略类型，display_name 是展示名称，参数里的 symbol/timeframe 才是研究条件。
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
                  策略类型 name
                </label>
                <select
                  value={strategyForm.name}
                  onChange={(e) => {
                    const nextType = e.target.value as StrategyPresetKey;
                    setFormError(null);
                    setStrategyForm(updateStrategyFormPreset(strategyForm, nextType, true));
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  {Object.entries(STRATEGY_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  切换类型会重置该类型的专属参数，但会尽量保留标的、周期和资金设置。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  展示名称 display_name
                </label>
                <input
                  type="text"
                  value={strategyForm.display_name}
                  onChange={(e) => {
                    setFormError(null);
                    setStrategyForm({ ...strategyForm, display_name: e.target.value });
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="例如：美股双均线趋势策略"
                />
                <p className="mt-1 text-xs text-gray-500">
                  仅用于界面展示与回测报告，内部策略类型请看上面的 name。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  策略描述
                </label>
                <textarea
                  value={strategyForm.description}
                  onChange={(e) => {
                    setFormError(null);
                    setStrategyForm({ ...strategyForm, description: e.target.value });
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  rows={3}
                  placeholder="描述策略的原理和使用方法..."
                />
                <p className="mt-1 text-xs text-gray-500">
                  描述会随策略保存，适合写清研究假设和使用限制。
                </p>
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
                  onChange={(e) => {
                    setFormError(null);
                    setStrategyForm({ ...strategyForm, is_active: e.target.checked });
                  }}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="edit_is_active" className="ml-2 text-sm text-gray-700">
                  启用该策略
                </label>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={handleResetEditForm}
                  disabled={updateStrategyMutation.isPending}
                  className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  恢复原始配置
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditForm(false);
                    setSelectedStrategy(null);
                    setFormError(null);
                  }}
                  disabled={updateStrategyMutation.isPending}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">{backtestMode === 'batch' ? '批量实验' : '运行回测'}</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {backtestMode === 'batch'
                    ? '在同一实验批次里顺序执行 2-5 组参数覆盖。'
                    : '保留当前策略配置做一次完整回测。'}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowBacktestModal(false);
                  resetBacktestForm();
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm text-gray-500">策略名称</p>
                <p className="font-medium text-gray-900">{getStrategyDisplayName(selectedStrategy)}</p>
                <p className="mt-1 text-xs text-gray-500">
                  name: {selectedStrategy.name} · 标的: {String(selectedStrategy.parameters?.symbol ?? '-')} · 周期: {String(selectedStrategy.parameters?.timeframe ?? '-')}
                </p>
              </div>

              <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-sm font-medium text-gray-900">提交前确认</p>
                <p className="mt-1 text-xs text-gray-500">
                  {backtestMode === 'batch'
                    ? '请先核对实验标签和参数覆盖，再顺序提交多个参数组合。'
                    : '请先核对本次研究条件，确认无误后再运行回测。'}
                </p>
                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-gray-500">策略展示名称</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">
                      {getStrategyDisplayName(selectedStrategy)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">标的</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">
                      {formatBacktestSummaryValue(selectedStrategy.parameters?.symbol)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">周期</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">
                      {formatBacktestSummaryValue(selectedStrategy.parameters?.timeframe)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">初始资金</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">
                      {formatBacktestSummaryValue(selectedStrategy.parameters?.initial_capital)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">手续费 / 滑点</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">
                      {formatBacktestSummaryValue(selectedStrategy.parameters?.fee_bps, ' bps')}
                      {' / '}
                      {formatBacktestSummaryValue(selectedStrategy.parameters?.slippage_bps, ' bps')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">回测区间</dt>
                    <dd className="mt-1 text-sm font-medium text-gray-900">
                      {backtestParams.start_date || '待填写'} - {backtestParams.end_date || '待填写'}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">实验标签</label>
                  <input
                    type="text"
                    value={experimentLabel}
                    onChange={(e) => setExperimentLabel(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    placeholder="例如：SMA 2026-04 波动测试"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">参数版本</label>
                  <input
                    type="text"
                    value={parameterVersion}
                    onChange={(e) => setParameterVersion(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    placeholder="例如：v1.0 / 2026-04-03"
                  />
                </div>
                <div className="flex items-end">
                  <div className="flex w-full rounded-md border border-gray-200 bg-gray-50 p-1">
                    <button
                      type="button"
                      onClick={() => setBacktestMode('single')}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
                        backtestMode === 'single' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600'
                      }`}
                    >
                      单次
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBacktestMode('batch');
                        if (selectedStrategy) {
                          initializeBatchParameterSets(selectedStrategy);
                        }
                      }}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
                        backtestMode === 'batch' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600'
                      }`}
                    >
                      批量
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">实验备注</label>
                <textarea
                  value={experimentNote}
                  onChange={(e) => setExperimentNote(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  rows={3}
                  placeholder="补充实验假设、数据窗口或任何需要在回测后复盘的说明"
                />
              </div>

              {backtestMode === 'batch' && (
                <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-sky-900">参数覆盖 JSON</p>
                      <p className="text-xs text-sky-800">
                        填写 2-5 个对象，每个对象会覆盖当前策略参数中的对应字段。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectedStrategy && initializeBatchParameterSets(selectedStrategy)}
                      className="rounded-md border border-sky-200 bg-white px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50"
                    >
                      重置示例
                    </button>
                  </div>
                  <textarea
                    value={batchParameterSetsText}
                    onChange={(e) => setBatchParameterSetsText(e.target.value)}
                    className="min-h-56 w-full rounded-md border border-sky-200 bg-white px-3 py-2 font-mono text-sm text-slate-700"
                    placeholder={serializeBacktestParameterSets(buildDefaultBacktestParameterSets(selectedStrategy))}
                  />
                </div>
              )}

              {backtestError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 whitespace-pre-wrap text-red-700">
                  {backtestError}
                </div>
              )}

              <form onSubmit={handleSubmitBacktest} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">开始日期</label>
                  <input
                    type="date"
                    value={backtestParams.start_date}
                    onChange={(e) => {
                      setBacktestError(null);
                      setBacktestParams({ ...backtestParams, start_date: e.target.value });
                    }}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">结束日期</label>
                  <input
                    type="date"
                    value={backtestParams.end_date}
                    onChange={(e) => {
                      setBacktestError(null);
                      setBacktestParams({ ...backtestParams, end_date: e.target.value });
                    }}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    required
                  />
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowBacktestModal(false);
                      resetBacktestForm();
                    }}
                    disabled={isBacktestSubmitting}
                    className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isBacktestSubmitting}
                    className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isBacktestSubmitting
                      ? '运行中...'
                      : backtestMode === 'batch'
                        ? '运行批量实验'
                        : '运行回测'}
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
