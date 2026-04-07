'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { strategyApi, tradeApi } from '@/lib/api';
import type { BacktestResult, StrategyConfig } from '@/types';
import {
  buildBacktestFilterSummary,
  buildParameterSnapshotSummary,
  describeBacktestExperiment,
  deriveBacktestStrategyName,
  deriveRunSnapshotName,
  getReferenceTradesForBacktestWindow,
  hasActiveBacktestFilters,
} from './report-helpers';
import {
  buildBacktestExportRows,
  getBacktestResultKey,
  serializeBacktestExportRowsToCsv,
  serializeBacktestExportRowsToJson,
} from './backtest-efficiency';
import {
  buildBacktestExportFilename,
  canExportBacktests,
  toggleExpandedRunId,
} from './backtest-page-helpers';
import {
  BarChart3,
  CheckSquare,
  Download,
  Square,
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  Database,
  X,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export default function BacktestPage() {
  const [selectedStrategyId, setSelectedStrategyId] = useState('all');
  const [strategyNameFilter, setStrategyNameFilter] = useState('');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [experimentLabelFilter, setExperimentLabelFilter] = useState('');
  const [parameterVersionFilter, setParameterVersionFilter] = useState('');
  const [createdAfterFilter, setCreatedAfterFilter] = useState('');
  const [createdBeforeFilter, setCreatedBeforeFilter] = useState('');
  const [sortBy, setSortBy] = useState<'created_at' | 'total_return' | 'max_drawdown' | 'sharpe_ratio'>(
    'created_at'
  );
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);

  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => strategyApi.getStrategies(),
    staleTime: 60000,
  });

  const { data: backtestResults = [], isLoading: resultsLoading } = useQuery({
    queryKey: [
      'backtest-history',
      selectedStrategyId,
      symbolFilter,
      experimentLabelFilter,
      parameterVersionFilter,
      createdAfterFilter,
      createdBeforeFilter,
    ],
    queryFn: () =>
      strategyApi.listBacktestsWithFilters({
        strategy_id: selectedStrategyId === 'all' ? undefined : selectedStrategyId,
        symbol: symbolFilter.trim() || undefined,
        experiment_label: experimentLabelFilter.trim() || undefined,
        parameter_version: parameterVersionFilter.trim() || undefined,
        created_after: createdAfterFilter
          ? new Date(`${createdAfterFilter}T00:00:00Z`).toISOString()
          : undefined,
        created_before: createdBeforeFilter
          ? new Date(`${createdBeforeFilter}T23:59:59.999Z`).toISOString()
          : undefined,
        limit: 100,
      }),
    staleTime: 60000,
  });

  const { data: executionTrades = [] } = useQuery({
    queryKey: ['execution-trades', selectedStrategyId, symbolFilter],
    queryFn: () =>
      tradeApi.listTrades({
        strategy_id: selectedStrategyId === 'all' ? undefined : selectedStrategyId,
        symbol: symbolFilter.trim() || undefined,
        limit: 500,
      }),
    staleTime: 30000,
  });

  const strategyOptions = useMemo(
    () => [
      { id: 'all', name: '全部策略' },
      ...strategies.map((strategy: StrategyConfig) => ({
        id: strategy.id,
        name: strategy.display_name || strategy.name,
      })),
    ],
    [strategies]
  );

  const strategiesById = useMemo(
    () =>
      new Map(
        strategies.map((strategy: StrategyConfig) => [strategy.id, strategy])
      ),
    [strategies]
  );

  const strategyNameById = useMemo(
    () =>
      new Map(
        strategies.map((strategy: StrategyConfig) => [
          strategy.id,
          strategy.display_name || strategy.name,
        ])
      ),
    [strategies]
  );

  const selectedStrategyName =
    selectedStrategyId === 'all'
      ? undefined
      : strategyOptions.find((option) => option.id === selectedStrategyId)?.name;

  const sortLabelMap: Record<typeof sortBy, string> = {
    created_at: '最新',
    total_return: '收益率',
    max_drawdown: '回撤',
    sharpe_ratio: 'Sharpe',
  };

  const activeFilterSummary = buildBacktestFilterSummary({
    selectedStrategyName,
    strategyNameKeyword: strategyNameFilter,
    symbol: symbolFilter,
    experimentLabel: experimentLabelFilter,
    parameterVersion: parameterVersionFilter,
    createdAfter: createdAfterFilter,
    createdBefore: createdBeforeFilter,
    sortLabel: sortLabelMap[sortBy],
  });

  const canResetFilters = hasActiveBacktestFilters({
    selectedStrategyId,
    strategyNameKeyword: strategyNameFilter,
    symbol: symbolFilter,
    experimentLabel: experimentLabelFilter,
    parameterVersion: parameterVersionFilter,
    createdAfter: createdAfterFilter,
    createdBefore: createdBeforeFilter,
  });

  const filteredBacktestResults = useMemo(() => {
    const keyword = strategyNameFilter.trim().toLowerCase();
    const experimentLabelKeyword = experimentLabelFilter.trim().toLowerCase();
    const parameterVersionKeyword = parameterVersionFilter.trim().toLowerCase();
    const createdAfterTimestamp = createdAfterFilter ? new Date(`${createdAfterFilter}T00:00:00Z`).getTime() : null;
    const createdBeforeTimestamp = createdBeforeFilter ? new Date(`${createdBeforeFilter}T23:59:59.999Z`).getTime() : null;

    const nextResults = backtestResults.filter((result: BacktestResult) => {
      const strategyName = (strategyNameById.get(result.strategy_id) ?? result.strategy_name ?? result.strategy_id)
        .toLowerCase();
      const experimentLabel = (result.experiment_label ?? '').toLowerCase();
      const parameterVersion = (result.parameter_version ?? '').toLowerCase();
      const createdAt = new Date(result.created_at ?? result.start_date).getTime();

      if (keyword && !strategyName.includes(keyword)) {
        return false;
      }

      if (experimentLabelKeyword && !experimentLabel.includes(experimentLabelKeyword)) {
        return false;
      }

      if (parameterVersionKeyword && !parameterVersion.includes(parameterVersionKeyword)) {
        return false;
      }

      if (createdAfterTimestamp !== null && createdAt < createdAfterTimestamp) {
        return false;
      }

      if (createdBeforeTimestamp !== null && createdAt > createdBeforeTimestamp) {
        return false;
      }

      return true;
    });

    const compare = (left: BacktestResult, right: BacktestResult) => {
      switch (sortBy) {
        case 'total_return':
          return right.total_return - left.total_return;
        case 'max_drawdown':
          return left.max_drawdown - right.max_drawdown;
        case 'sharpe_ratio':
          return right.sharpe_ratio - left.sharpe_ratio;
        default:
          return new Date(right.created_at ?? right.start_date).getTime() - new Date(left.created_at ?? left.start_date).getTime();
      }
    };

    return [...nextResults].sort(compare);
  }, [
    backtestResults,
    createdAfterFilter,
    createdBeforeFilter,
    experimentLabelFilter,
    parameterVersionFilter,
    sortBy,
    strategyNameById,
    strategyNameFilter,
  ]);

  const filteredResultsByKey = useMemo(
    () => new Map(filteredBacktestResults.map((result) => [getBacktestResultKey(result), result])),
    [filteredBacktestResults]
  );

  const selectedComparisonResults = useMemo(
    () =>
      compareSelection
        .map((runKey) => filteredResultsByKey.get(runKey))
        .filter((result): result is BacktestResult => Boolean(result)),
    [compareSelection, filteredResultsByKey]
  );

  const experimentGroups = useMemo(() => {
    const groups = new Map<string, BacktestResult[]>();

    filteredBacktestResults.forEach((result) => {
      if (!result.experiment_id) {
        return;
      }

      const current = groups.get(result.experiment_id) ?? [];
      current.push(result);
      groups.set(result.experiment_id, current);
    });

    return Array.from(groups.entries())
      .map(([experimentId, results]) => ({
        experimentId,
        results: [...results].sort(
          (left, right) =>
            new Date(right.created_at ?? right.start_date).getTime() -
            new Date(left.created_at ?? left.start_date).getTime()
        ),
      }))
      .filter((group) => group.results.length > 1);
  }, [filteredBacktestResults]);

  const comparisonStrategyId = selectedComparisonResults[0]?.strategy_id ?? null;
  const comparisonExperimentId =
    selectedComparisonResults.length > 0 &&
    selectedComparisonResults.every(
      (result) => result.experiment_id && result.experiment_id === selectedComparisonResults[0]?.experiment_id
    )
      ? selectedComparisonResults[0]?.experiment_id ?? null
      : null;

  const comparisonExportRows = useMemo(
    () =>
      buildBacktestExportRows(selectedComparisonResults, (result) =>
        deriveBacktestStrategyName(result, strategiesById.get(result.strategy_id))
      ),
    [selectedComparisonResults, strategiesById]
  );
  const canExportComparisonResults = canExportBacktests(comparisonExportRows.length);

  useEffect(() => {
    setCompareSelection((current) => {
      const next = current.filter((runKey) => filteredResultsByKey.has(runKey));
      return next.length === current.length && next.every((runKey, index) => runKey === current[index])
        ? current
        : next;
    });
  }, [filteredResultsByKey]);

  const scrollToRunCard = (runKey: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      document.getElementById(`backtest-run-${runKey}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  const expandRun = (runKey: string) => {
    setExpandedRunId((current) => toggleExpandedRunId(current, runKey));
  };

  const collapseRun = (runKey: string) => {
    setExpandedRunId(null);
    scrollToRunCard(runKey);
  };

  const toggleCompareSelection = (result: BacktestResult) => {
    const runKey = getBacktestResultKey(result);

    setCompareSelection((current) => {
      if (current.includes(runKey)) {
        return current.filter((item) => item !== runKey);
      }

      const currentStrategyId =
        current
          .map((item) => filteredResultsByKey.get(item)?.strategy_id)
          .find((strategyId): strategyId is string => Boolean(strategyId)) ?? null;

      if (currentStrategyId && currentStrategyId !== result.strategy_id) {
        return [runKey];
      }

      return [...current, runKey];
    });
  };

  const clearCompareSelection = () => {
    setCompareSelection([]);
  };

  const downloadTextFile = (filename: string, content: string, mimeType: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const exportBacktests = (format: 'json' | 'csv', results: BacktestResult[], scope: string) => {
    const rows = buildBacktestExportRows(results, (result) =>
      deriveBacktestStrategyName(result, strategiesById.get(result.strategy_id))
    );
    const filenameBase = buildBacktestExportFilename(scope);

    if (format === 'json') {
      downloadTextFile(
        `${filenameBase}.json`,
        serializeBacktestExportRowsToJson(rows),
        'application/json'
      );
      return;
    }

    downloadTextFile(
      `${filenameBase}.csv`,
      serializeBacktestExportRowsToCsv(rows),
      'text/csv'
    );
  };

  const getReturnColor = (value: number) => {
    return value >= 0 ? 'text-green-600' : 'text-red-600';
  };

  const getSharpeColor = (value: number) => {
    if (value > 2) return 'text-green-600';
    if (value > 1) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getBacktestStrategyName = (result: BacktestResult) =>
    deriveBacktestStrategyName(result, strategiesById.get(result.strategy_id));

  const canExportFilteredResults = canExportBacktests(filteredBacktestResults.length);

  const getBacktestStrategyType = (result: BacktestResult) =>
    strategiesById.get(result.strategy_id)?.name ?? '-';

  const getRunSnapshotName = (result: BacktestResult) =>
    deriveRunSnapshotName(result, strategiesById.get(result.strategy_id));

  const getReferenceTradesForRun = (result: BacktestResult) =>
    getReferenceTradesForBacktestWindow(
      result,
      executionTrades,
      strategiesById.get(result.strategy_id)
    );

  const getExperimentResults = (result: BacktestResult) => {
    if (!result.experiment_id) {
      return [result];
    }

    return filteredBacktestResults.filter(
      (candidate) => candidate.experiment_id === result.experiment_id
    );
  };

  const compareExperimentResults = (result: BacktestResult) => {
    const experimentResults = getExperimentResults(result);
    if (experimentResults.length < 2) {
      return;
    }

    setCompareSelection(experimentResults.map(getBacktestResultKey));
  };

  const resetFilters = () => {
    setSelectedStrategyId('all');
    setStrategyNameFilter('');
    setSymbolFilter('');
    setExperimentLabelFilter('');
    setParameterVersionFilter('');
    setCreatedAfterFilter('');
    setCreatedBeforeFilter('');
    setSortBy('created_at');
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">回测报告</h1>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600">
          <Database className="h-4 w-4 text-blue-600" />
          历史数据来自已持久化回测记录
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">策略筛选</label>
          <select
            value={selectedStrategyId}
            onChange={(e) => setSelectedStrategyId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          >
            {strategyOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">策略名称</label>
          <div className="flex gap-2">
            <input
              value={strategyNameFilter}
              onChange={(e) => setStrategyNameFilter(e.target.value)}
              placeholder="输入策略名称关键字"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
            <button
              type="button"
              onClick={() => setStrategyNameFilter('')}
              disabled={!strategyNameFilter}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              清空
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">标的筛选</label>
          <input
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            placeholder="例如 AAPL"
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </div>
        <div className="flex items-end">
          <div className="flex w-full items-center gap-2">
            <div className="flex-1 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
              当前结果 {filteredBacktestResults.length} 条
            </div>
            <button
              type="button"
              onClick={resetFilters}
              disabled={!canResetFilters}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              重置全部筛选
            </button>
          </div>
        </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">实验标签</label>
            <input
              value={experimentLabelFilter}
              onChange={(e) => setExperimentLabelFilter(e.target.value)}
              placeholder="例如：SMA 2026-04"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">参数版本</label>
            <input
              value={parameterVersionFilter}
              onChange={(e) => setParameterVersionFilter(e.target.value)}
              placeholder="例如：v1.0"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">开始时间</label>
            <input
              type="date"
              value={createdAfterFilter}
              onChange={(e) => setCreatedAfterFilter(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">结束时间</label>
            <input
              type="date"
              value={createdBeforeFilter}
              onChange={(e) => setCreatedBeforeFilter(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="w-full max-w-xs">
            <label className="mb-1 block text-sm font-medium text-gray-700">排序方式</label>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'created_at' | 'total_return' | 'max_drawdown' | 'sharpe_ratio')
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="created_at">最新</option>
              <option value="total_return">总收益率</option>
              <option value="max_drawdown">最大回撤</option>
              <option value="sharpe_ratio">Sharpe</option>
            </select>
          </div>
          <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
            当前结果 {filteredBacktestResults.length} 条
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
        <span className="font-medium text-gray-900">当前筛选:</span> {activeFilterSummary}
      </div>

      <div className="rounded-lg border border-dashed border-sky-200 bg-sky-50/60 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-sky-900">
              <Target className="h-4 w-4" />
              研究效率工具
            </div>
            <p className="mt-1 text-sm text-sky-800">
              勾选同一策略的多个回测结果进行对比，也可以一键带出同一实验批次的全部结果。
            </p>
            <p className="mt-1 text-xs text-sky-700">
              {selectedComparisonResults.length > 0
                ? `已选择 ${selectedComparisonResults.length} 条回测结果${comparisonStrategyId ? ` · 策略 ID ${comparisonStrategyId}` : ''}${comparisonExperimentId ? ` · 实验 ${comparisonExperimentId.slice(0, 8)}` : ''}`
                : '当前没有选中的对比结果。'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => exportBacktests('json', filteredBacktestResults, 'filtered')}
              disabled={!canExportFilteredResults}
              className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              导出筛选 JSON
            </button>
            <button
              type="button"
              onClick={() => exportBacktests('csv', filteredBacktestResults, 'filtered')}
              disabled={!canExportFilteredResults}
              className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              导出筛选 CSV
            </button>
            <button
              type="button"
              onClick={clearCompareSelection}
              disabled={compareSelection.length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              清空对比
            </button>
          </div>
        </div>

        {experimentGroups.length > 0 && (
          <div className="mt-4 rounded-lg border border-sky-100 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-slate-900">实验批次</h3>
                <p className="mt-1 text-xs text-slate-500">
                  按实验批次查看同一组参数覆盖产生的多条回测结果。
                </p>
              </div>
              <div className="text-xs text-slate-500">共 {experimentGroups.length} 个批次</div>
            </div>

            <div className="mt-4 space-y-3">
              {experimentGroups.map((group) => {
                const anchorRunKey = getBacktestResultKey(group.results[0]);
                const label = group.results[0]?.experiment_label?.trim() || '未命名实验';
                const version = group.results[0]?.parameter_version?.trim() || '未标注版本';

                return (
                  <div
                    key={group.experimentId}
                    className="flex flex-col gap-3 rounded-lg border border-sky-100 bg-sky-50/40 p-3 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                        <span>{label}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs text-sky-700">
                          {version}
                        </span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                          实验 {group.experimentId.slice(0, 8)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {group.results.length} 条结果 · 最新于{' '}
                        {new Date(
                          group.results[0]?.created_at ?? group.results[0]?.start_date
                        ).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => compareExperimentResults(group.results[0])}
                        className="inline-flex items-center gap-2 rounded-md border border-sky-300 bg-white px-3 py-2 text-sm text-sky-700 hover:bg-sky-50"
                      >
                        <CheckSquare className="h-4 w-4" />
                        对比同批次
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          exportBacktests(
                            'json',
                            group.results,
                            `experiment-${group.experimentId.slice(0, 8)}`
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 hover:bg-sky-50"
                      >
                        <Download className="h-4 w-4" />
                        导出批次 JSON
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          exportBacktests(
                            'csv',
                            group.results,
                            `experiment-${group.experimentId.slice(0, 8)}`
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 hover:bg-sky-50"
                      >
                        <Download className="h-4 w-4" />
                        导出批次 CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollToRunCard(anchorRunKey)}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        查看结果
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {selectedComparisonResults.length > 0 && comparisonStrategyId && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-sky-100 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-sky-50 text-left text-slate-600">
                <tr>
                  <th className="sticky left-0 z-10 bg-sky-50 px-4 py-3">指标</th>
                  {selectedComparisonResults.map((result) => {
                    const runKey = getBacktestResultKey(result);
                    return (
                      <th key={runKey} className="min-w-56 px-4 py-3 align-top">
                        <div className="space-y-1">
                          <div className="font-medium text-slate-900">{getBacktestStrategyName(result)}</div>
                          <div className="text-xs text-slate-500">
                            {result.symbol || '-'} · {result.timeframe || '-'}
                          </div>
                          <div className="text-xs text-slate-500">
                            {new Date(result.start_date).toLocaleDateString('zh-CN')} -{' '}
                            {new Date(result.end_date).toLocaleDateString('zh-CN')}
                          </div>
                          {(result.experiment_label || result.parameter_version) && (
                            <div className="flex flex-wrap gap-1 text-[11px] text-sky-700">
                              {result.experiment_label && (
                                <span className="rounded-full bg-sky-50 px-2 py-0.5">
                                  {result.experiment_label}
                                </span>
                              )}
                              {result.parameter_version && (
                                <span className="rounded-full bg-sky-50 px-2 py-0.5">
                                  {result.parameter_version}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="font-mono text-xs text-slate-400">
                            {result.run_id?.slice(0, 8) ?? runKey.slice(0, 12)}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: '总收益率',
                    format: (value: number) => `${(value * 100).toFixed(2)}%`,
                    getValue: (result: BacktestResult) => result.total_return,
                  },
                  {
                    label: '年化收益率',
                    format: (value: number) => `${(value * 100).toFixed(2)}%`,
                    getValue: (result: BacktestResult) => result.annualized_return,
                  },
                  {
                    label: '最大回撤',
                    format: (value: number) => `${(value * 100).toFixed(2)}%`,
                    getValue: (result: BacktestResult) => result.max_drawdown,
                  },
                  {
                    label: 'Sharpe',
                    format: (value: number) => value.toFixed(2),
                    getValue: (result: BacktestResult) => result.sharpe_ratio,
                  },
                  {
                    label: '胜率',
                    format: (value: number) => `${(value * 100).toFixed(1)}%`,
                    getValue: (result: BacktestResult) => result.win_rate,
                  },
                ].map((metric) => {
                  const values = selectedComparisonResults.map((result) => metric.getValue(result));
                  const bestValue =
                    metric.label === '最大回撤' ? Math.min(...values) : Math.max(...values);

                  return (
                    <tr key={metric.label} className="border-t border-sky-100">
                      <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-medium text-slate-700">
                        {metric.label}
                      </th>
                      {selectedComparisonResults.map((result) => {
                        const value = metric.getValue(result);
                        const isBest = value === bestValue;
                        return (
                          <td
                            key={`${metric.label}-${getBacktestResultKey(result)}`}
                            className={`px-4 py-3 font-medium ${isBest ? 'bg-emerald-50 text-emerald-700' : 'text-slate-900'}`}
                          >
                            {metric.format(value)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-100 px-4 py-3 text-xs text-slate-500">
              <span>
                {comparisonExperimentId
                  ? `当前导出的是同一实验批次 ${comparisonExperimentId.slice(0, 8)} 的对比结果。`
                  : '对比结果仅保留同一策略下的回测记录，便于快速比较不同时间段或参数快照。'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadTextFile(
                      `${buildBacktestExportFilename('comparison')}.json`,
                      serializeBacktestExportRowsToJson(comparisonExportRows),
                      'application/json'
                    )
                  }
                  disabled={!canExportComparisonResults}
                  className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  导出对比 JSON
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadTextFile(
                      `${buildBacktestExportFilename('comparison')}.csv`,
                      serializeBacktestExportRowsToCsv(comparisonExportRows),
                      'text/csv'
                    )
                  }
                  disabled={!canExportComparisonResults}
                  className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  导出对比 CSV
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {resultsLoading ? (
        <div className="bg-white p-12 rounded-lg shadow">
          <div className="animate-pulse space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredBacktestResults.map((result: BacktestResult) => {
            const runKey = getBacktestResultKey(result);
            const isCompareSelected = compareSelection.includes(runKey);
            const experimentResults = getExperimentResults(result);
            const hasExperimentBatch = Boolean(result.experiment_id && experimentResults.length > 1);

            return (
            <div id={`backtest-run-${runKey}`} key={runKey} className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">
                      {getBacktestStrategyName(result)}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="rounded-full bg-amber-50 px-2 py-1 font-medium text-amber-700">
                        类型: {getBacktestStrategyType(result)}
                      </span>
                      {result.symbol && (
                        <span className="rounded-full bg-blue-50 px-2 py-1 font-medium text-blue-700">
                          {result.symbol}
                        </span>
                      )}
                      {result.timeframe && (
                        <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700">
                          {result.timeframe}
                        </span>
                      )}
                      {result.run_id && (
                        <span className="font-mono text-gray-400">
                          {result.run_id.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    {(result.experiment_label || result.parameter_version || result.experiment_note || result.experiment_id) && (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-sky-700">
                        {describeBacktestExperiment(result).map((item) => (
                          <span
                            key={item}
                            className="rounded-full bg-sky-50 px-2 py-1 font-medium text-sky-700"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <Clock className="h-4 w-4" />
                      <span>
                        {new Date(result.start_date).toLocaleDateString('zh-CN')} -{' '}
                        {new Date(result.end_date).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    {result.created_at && (
                      <p className="mt-2">
                        运行时间 {new Date(result.created_at).toLocaleString('zh-CN')}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {hasExperimentBatch && (
                    <button
                      type="button"
                      onClick={() => compareExperimentResults(result)}
                      className="inline-flex items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-700 hover:bg-sky-100"
                    >
                      <CheckSquare className="h-4 w-4" />
                      对比同批次
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => exportBacktests('json', [result], 'snapshot')}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Download className="h-4 w-4" />
                    快照 JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => exportBacktests('csv', [result], 'snapshot')}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Download className="h-4 w-4" />
                    快照 CSV
                  </button>
                  {hasExperimentBatch && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          exportBacktests(
                            'json',
                            experimentResults,
                            `experiment-${result.experiment_id?.slice(0, 8) ?? 'batch'}`
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-md border border-sky-200 px-3 py-2 text-sm text-sky-700 hover:bg-sky-50"
                      >
                        <Download className="h-4 w-4" />
                        导出批次 JSON
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          exportBacktests(
                            'csv',
                            experimentResults,
                            `experiment-${result.experiment_id?.slice(0, 8) ?? 'batch'}`
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-md border border-sky-200 px-3 py-2 text-sm text-sky-700 hover:bg-sky-50"
                      >
                        <Download className="h-4 w-4" />
                        导出批次 CSV
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleCompareSelection(result)}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      isCompareSelected
                        ? 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                    aria-pressed={isCompareSelected}
                  >
                    {isCompareSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    {isCompareSelected ? '已加入对比' : '加入对比'}
                  </button>
                  <button
                    type="button"
                    onClick={() => (expandedRunId === runKey ? collapseRun(runKey) : expandRun(runKey))}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    aria-expanded={expandedRunId === runKey}
                  >
                    {expandedRunId === runKey ? '收起详情' : '查看详情'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">总收益率</span>
                      {result.total_return >= 0 ? (
                        <TrendingUp className="h-5 w-5 text-green-600" />
                      ) : (
                        <TrendingDown className="h-5 w-5 text-red-600" />
                      )}
                    </div>
                    <p className={`text-2xl font-bold ${getReturnColor(result.total_return)}`}>
                      {(result.total_return * 100).toFixed(2)}%
                    </p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">年化收益率</span>
                      <TrendingUp className="h-5 w-5 text-blue-600" />
                    </div>
                    <p className={`text-2xl font-bold ${getReturnColor(result.annualized_return)}`}>
                      {(result.annualized_return * 100).toFixed(2)}%
                    </p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">Sharpe比率</span>
                      <Target className="h-5 w-5 text-purple-600" />
                    </div>
                    <p className={`text-2xl font-bold ${getSharpeColor(result.sharpe_ratio)}`}>
                      {result.sharpe_ratio.toFixed(2)}
                    </p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">最大回撤</span>
                      <TrendingDown className="h-5 w-5 text-red-600" />
                    </div>
                    <p className="text-2xl font-bold text-red-600">
                      {(result.max_drawdown * 100).toFixed(2)}%
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-base font-medium text-gray-900 mb-4">交易统计</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">总交易次数</span>
                        <span className="font-medium text-gray-900">{result.total_trades}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">胜率</span>
                        <span className={`font-medium ${result.win_rate >= 0.5 ? 'text-green-600' : 'text-red-600'}`}>
                          {(result.win_rate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">初始资金</span>
                        <span className="font-medium text-gray-900">${result.initial_capital.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">最终资金</span>
                        <span className={`font-medium ${result.final_capital >= result.initial_capital ? 'text-green-600' : 'text-red-600'}`}>
                          ${result.final_capital.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-base font-medium text-gray-900 mb-4">盈亏分析</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">总盈亏</span>
                        <span className={`font-medium ${result.performance_metrics.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ${result.performance_metrics.total_pnl.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">盈利因子</span>
                        <span className="font-medium text-gray-900">{result.performance_metrics.profit_factor.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">平均盈利</span>
                        <span className="font-medium text-green-600">
                          ${result.performance_metrics.average_win.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">平均亏损</span>
                        <span className="font-medium text-red-600">
                          ${result.performance_metrics.average_loss.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">最大盈利</span>
                        <span className="font-medium text-green-600">
                          ${result.performance_metrics.largest_win.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">最大亏损</span>
                        <span className="font-medium text-red-600">
                          ${result.performance_metrics.largest_loss.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      {
                        name: '总盈亏',
                        value: result.performance_metrics.total_pnl,
                      },
                      {
                        name: '总盈利',
                        value: result.performance_metrics.gross_profit,
                      },
                      {
                        name: '总亏损',
                        value: -result.performance_metrics.gross_loss,
                      },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="value" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {expandedRunId === runKey && (
                  <div className="space-y-6 border-t border-gray-100 pt-6">
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                      <div>
                        <h4 className="mb-3 text-base font-medium text-gray-900">运行元数据</h4>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between rounded bg-gray-50 p-3">
                            <span className="text-sm text-gray-700">运行 ID</span>
                            <span className="font-mono text-sm text-gray-900">{result.run_id ?? '-'}</span>
                          </div>
                          <div className="flex items-center justify-between rounded bg-gray-50 p-3">
                            <span className="text-sm text-gray-700">策略名称</span>
                            <span className="text-sm font-medium text-gray-900">
                              {getBacktestStrategyName(result)}
                            </span>
                          </div>
                          {getRunSnapshotName(result) && (
                            <div className="flex items-center justify-between rounded bg-amber-50 p-3">
                              <span className="text-sm text-amber-800">运行时名称</span>
                              <span className="text-sm font-medium text-amber-900">
                                {getRunSnapshotName(result)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between rounded bg-gray-50 p-3">
                            <span className="text-sm text-gray-700">策略类型</span>
                            <span className="font-mono text-sm text-gray-900">
                              {getBacktestStrategyType(result)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded bg-gray-50 p-3">
                            <span className="text-sm text-gray-700">策略 ID</span>
                            <span className="font-mono text-sm text-gray-900">{result.strategy_id}</span>
                          </div>
                          <div className="flex items-center justify-between rounded bg-gray-50 p-3">
                            <span className="text-sm text-gray-700">运行时间</span>
                            <span className="text-sm font-medium text-gray-900">
                              {result.created_at ? new Date(result.created_at).toLocaleString('zh-CN') : '-'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded bg-gray-50 p-3">
                            <span className="text-sm text-gray-700">回测区间</span>
                            <span className="text-sm font-medium text-gray-900">
                              {new Date(result.start_date).toLocaleDateString('zh-CN')} -{' '}
                              {new Date(result.end_date).toLocaleDateString('zh-CN')}
                            </span>
                          </div>
                          <div className="rounded bg-blue-50 p-3 text-sm text-blue-900">
                            <p className="font-medium">数据来源说明</p>
                            <p className="mt-1">
                              本卡片的收益指标与参数来自已持久化的回测记录；下方“模拟成交明细”来自该次回测生成的
                              虚拟成交；“参考执行成交”按策略、标的和时间区间匹配真实执行记录，仅用于对照，不代表与该回测运行一一绑定。
                            </p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="mb-3 text-base font-medium text-gray-900">参数快照</h4>
                        {(() => {
                          const parameterSummary = buildParameterSnapshotSummary(result.parameters);

                          return (
                            <div className="mb-3 flex flex-wrap gap-2">
                              {parameterSummary.map((item) => (
                                <span
                                  key={item}
                                  className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                                >
                                  {item}
                                </span>
                              ))}
                              {parameterSummary.length === 0 && (
                                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
                                  暂无参数摘要
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        <pre className="overflow-x-auto rounded bg-gray-950 p-4 text-xs text-gray-100">
                          {JSON.stringify(result.parameters ?? {}, null, 2)}
                        </pre>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                      <div className="rounded-lg border border-gray-200 p-4">
                        <h4 className="mb-3 text-base font-medium text-gray-900">资金曲线</h4>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={result.equity_curve ?? []}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                dataKey="timestamp"
                                tickFormatter={(value) => new Date(value).toLocaleDateString('zh-CN')}
                              />
                              <YAxis />
                              <Tooltip
                                labelFormatter={(value) => new Date(value).toLocaleString('zh-CN')}
                              />
                              <Legend />
                              <Line type="monotone" dataKey="equity" stroke="#2563eb" dot={false} name="权益" />
                              <Line type="monotone" dataKey="cash" stroke="#16a34a" dot={false} name="现金" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 p-4">
                        <h4 className="mb-3 text-base font-medium text-gray-900">模拟成交明细</h4>
                        <div className="max-h-64 overflow-auto">
                          <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 text-left text-gray-600">
                              <tr>
                                <th className="px-3 py-2">时间</th>
                                <th className="px-3 py-2">方向</th>
                                <th className="px-3 py-2">数量</th>
                                <th className="px-3 py-2">信号价</th>
                                <th className="px-3 py-2">成交价</th>
                                <th className="px-3 py-2">费用</th>
                                <th className="px-3 py-2">PnL</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(result.trades ?? []).map((trade, tradeIndex) => (
                                <tr key={`${trade.timestamp}-${tradeIndex}`} className="border-t border-gray-100">
                                  <td className="px-3 py-2 text-gray-600">
                                    {new Date(trade.timestamp).toLocaleString('zh-CN')}
                                  </td>
                                  <td className={`px-3 py-2 font-medium ${trade.side === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                                    {trade.side === 'buy' ? '买入' : '卖出'}
                                  </td>
                                  <td className="px-3 py-2 text-gray-900">{trade.quantity}</td>
                                  <td className="px-3 py-2 text-gray-900">${trade.signal_price.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-gray-900">${trade.execution_price.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-gray-900">${trade.fees.toFixed(2)}</td>
                                  <td className={`px-3 py-2 font-medium ${
                                    (trade.pnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'
                                  }`}>
                                    {trade.pnl == null ? '-' : `$${trade.pnl.toFixed(2)}`}
                                  </td>
                                </tr>
                              ))}
                              {(result.trades ?? []).length === 0 && (
                                <tr>
                                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                                    暂无模拟成交明细
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h4 className="text-base font-medium text-gray-900">参考执行成交</h4>
                          <p className="mt-1 text-sm text-gray-600">
                            来自 `trades` 表中按策略、标的和回测区间匹配到的执行记录，用于和回测模拟成交做参考对照。
                          </p>
                        </div>
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                          {getReferenceTradesForRun(result).length} 笔
                        </span>
                      </div>
                      <div className="max-h-72 overflow-auto rounded-lg bg-white">
                        <table className="min-w-full text-sm">
                          <thead className="bg-emerald-50 text-left text-gray-600">
                            <tr>
                              <th className="px-3 py-2">成交时间</th>
                              <th className="px-3 py-2">方向</th>
                              <th className="px-3 py-2">数量</th>
                              <th className="px-3 py-2">成交价</th>
                              <th className="px-3 py-2">标的</th>
                              <th className="px-3 py-2">订单 ID</th>
                            </tr>
                          </thead>
                          <tbody>
                            {getReferenceTradesForRun(result).map((trade) => (
                              <tr key={trade.id} className="border-t border-emerald-100">
                                <td className="px-3 py-2 text-gray-600">
                                  {new Date(trade.executed_at).toLocaleString('zh-CN')}
                                </td>
                                <td
                                  className={`px-3 py-2 font-medium ${
                                    trade.side === 'BUY' ? 'text-green-600' : 'text-red-600'
                                  }`}
                                >
                                  {trade.side === 'BUY' ? '买入' : '卖出'}
                                </td>
                                <td className="px-3 py-2 text-gray-900">{trade.quantity}</td>
                                <td className="px-3 py-2 text-gray-900">${trade.price.toFixed(2)}</td>
                                <td className="px-3 py-2 text-gray-900">{trade.symbol}</td>
                                <td className="px-3 py-2 font-mono text-xs text-gray-500">
                                  {trade.order_id.slice(0, 8)}
                                </td>
                              </tr>
                            ))}
                            {getReferenceTradesForRun(result).length === 0 && (
                              <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                                  当前策略、标的与回测区间内没有匹配到参考执行成交。
                                  <br />
                                  这通常表示该策略尚未产生可参考的执行记录，或现有执行记录不在该标的与时间范围内。
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex justify-end border-t border-gray-100 pt-4">
                      <button
                        type="button"
                        onClick={() => collapseRun(runKey)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        收起详情
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )})}

          {filteredBacktestResults.length === 0 && (
            <div className="bg-white p-12 rounded-lg shadow text-center">
              <BarChart3 className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">暂无回测历史</h3>
              <p className="text-sm text-gray-500 mb-4">
                在策略页运行回测后，结果会持久化并显示在这里
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
