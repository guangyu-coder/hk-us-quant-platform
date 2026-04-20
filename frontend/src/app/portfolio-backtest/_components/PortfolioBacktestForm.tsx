'use client';

import type {
  PortfolioBacktestConfigInput,
  PortfolioBacktestInstrumentType,
  PortfolioBacktestMarket,
  PortfolioBacktestRebalancingFrequency,
} from '@/types';
import {
  calculatePortfolioWeightTotal,
  formatPortfolioPercentage,
  validatePortfolioWeights,
} from '../portfolio-backtest-helpers';
import { Plus, Trash2 } from 'lucide-react';

export type PortfolioAssetDraft = {
  symbol: string;
  displayName: string;
  market: PortfolioBacktestMarket;
  instrumentType: PortfolioBacktestInstrumentType;
  targetWeight: number;
};

export type PortfolioBacktestFormValues = {
  name: string;
  description: string;
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  rebalancingFrequency: PortfolioBacktestRebalancingFrequency;
  startDate: string;
  endDate: string;
  isActive: boolean;
  assets: PortfolioAssetDraft[];
};

type PortfolioBacktestFormProps = {
  value: PortfolioBacktestFormValues;
  onChange: (next: PortfolioBacktestFormValues) => void;
  onSubmit: () => void;
  submitting?: boolean;
  errorMessage?: string | null;
};

const marketOptions: PortfolioBacktestMarket[] = ['US', 'HK'];
const instrumentTypeOptions: PortfolioBacktestInstrumentType[] = ['Common Stock', 'ETF'];
const frequencyOptions: PortfolioBacktestRebalancingFrequency[] = ['daily', 'weekly', 'monthly'];

export function createEmptyPortfolioAsset(): PortfolioAssetDraft {
  return {
    symbol: '',
    displayName: '',
    market: 'US',
    instrumentType: 'Common Stock',
    targetWeight: 0.5,
  };
}

export function buildPortfolioBacktestPayload(
  value: PortfolioBacktestFormValues
): PortfolioBacktestConfigInput {
  return {
    name: value.name.trim(),
    description: value.description.trim() || null,
    initial_capital: value.initialCapital,
    fee_bps: value.feeBps,
    slippage_bps: value.slippageBps,
    rebalancing_frequency: value.rebalancingFrequency,
    start_date: value.startDate,
    end_date: value.endDate,
    is_active: value.isActive,
    assets: value.assets.map((asset) => ({
      symbol: asset.symbol.trim(),
      display_name: asset.displayName.trim() || asset.symbol.trim(),
      market: asset.market,
      instrument_type: asset.instrumentType,
      target_weight: asset.targetWeight,
    })),
  };
}

export function PortfolioBacktestForm({
  value,
  onChange,
  onSubmit,
  submitting = false,
  errorMessage,
}: PortfolioBacktestFormProps) {
  const validation = validatePortfolioWeights(
    value.assets.map((asset) => ({
      symbol: asset.symbol,
      targetWeight: asset.targetWeight,
    }))
  );

  const totalWeight = calculatePortfolioWeightTotal(
    value.assets.map((asset) => ({
      symbol: asset.symbol,
      targetWeight: asset.targetWeight,
    }))
  );

  const updateAsset = (index: number, patch: Partial<PortfolioAssetDraft>) => {
    const nextAssets = value.assets.map((asset, assetIndex) =>
      assetIndex === index ? { ...asset, ...patch } : asset
    );
    onChange({ ...value, assets: nextAssets });
  };

  const addAsset = () => {
    onChange({
      ...value,
      assets: [...value.assets, createEmptyPortfolioAsset()],
    });
  };

  const removeAsset = (index: number) => {
    onChange({
      ...value,
      assets: value.assets.filter((_, assetIndex) => assetIndex !== index),
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm font-medium text-foreground">组合名称</span>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            placeholder="例如：美股科技五巨头"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-foreground">再平衡频率</span>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={value.rebalancingFrequency}
            onChange={(event) =>
              onChange({
                ...value,
                rebalancingFrequency: event.target.value as PortfolioBacktestRebalancingFrequency,
              })
            }
          >
            {frequencyOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 md:col-span-2">
          <span className="text-sm font-medium text-foreground">说明</span>
          <textarea
            className="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={value.description}
            onChange={(event) => onChange({ ...value, description: event.target.value })}
            placeholder="记录组合假设、市场范围或调仓意图"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-foreground">初始资金</span>
          <input
            type="number"
            min="1"
            step="1000"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={value.initialCapital}
            onChange={(event) => onChange({ ...value, initialCapital: Number(event.target.value) || 0 })}
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-foreground">手续费（bps）</span>
          <input
            type="number"
            min="0"
            step="0.1"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={value.feeBps}
            onChange={(event) => onChange({ ...value, feeBps: Number(event.target.value) || 0 })}
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-foreground">滑点（bps）</span>
          <input
            type="number"
            min="0"
            step="0.1"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={value.slippageBps}
            onChange={(event) => onChange({ ...value, slippageBps: Number(event.target.value) || 0 })}
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-foreground">开始日期</span>
          <input
            type="date"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={value.startDate}
            onChange={(event) => onChange({ ...value, startDate: event.target.value })}
          />
        </label>

        <label className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={value.isActive}
            onChange={(event) => onChange({ ...value, isActive: event.target.checked })}
          />
          配置创建后立即启用
        </label>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">组合标的</h2>
            <p className="text-sm text-muted-foreground">
              V1 先支持同市场固定权重组合，权重请按 0-1 输入，例如 `0.6 = 60%`
            </p>
          </div>
          <button
            type="button"
            onClick={addAsset}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            添加标的
          </button>
        </div>

        <div className="space-y-4 p-4">
          {value.assets.map((asset, index) => (
            <div key={`${asset.symbol}-${index}`} className="grid gap-3 rounded-xl border border-border/70 bg-background/50 p-4 md:grid-cols-12">
              <label className="space-y-2 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">代码</span>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={asset.symbol}
                  onChange={(event) => updateAsset(index, { symbol: event.target.value.toUpperCase() })}
                  placeholder="AAPL"
                />
              </label>

              <label className="space-y-2 md:col-span-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">显示名称</span>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={asset.displayName}
                  onChange={(event) => updateAsset(index, { displayName: event.target.value })}
                  placeholder="Apple"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">市场</span>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={asset.market}
                  onChange={(event) => updateAsset(index, { market: event.target.value as PortfolioBacktestMarket })}
                >
                  {marketOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">品类</span>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={asset.instrumentType}
                  onChange={(event) =>
                    updateAsset(index, {
                      instrumentType: event.target.value as PortfolioBacktestInstrumentType,
                    })
                  }
                >
                  {instrumentTypeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">目标权重</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.0001"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={asset.targetWeight}
                  onChange={(event) => updateAsset(index, { targetWeight: Number(event.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">{formatPortfolioPercentage(asset.targetWeight)}</p>
              </label>

              <div className="md:col-span-1 flex items-end justify-end">
                <button
                  type="button"
                  onClick={() => removeAsset(index)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-destructive/30 text-destructive"
                  aria-label={`删除第 ${index + 1} 个标的`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">当前权重合计</p>
            <p className="text-2xl font-semibold text-foreground">{formatPortfolioPercentage(totalWeight)}</p>
          </div>
          <div className="text-sm text-muted-foreground">
            {validation.message ? (
              <span className="text-destructive">{validation.message}</span>
            ) : (
              <span>权重校验通过，可以保存组合配置。</span>
            )}
          </div>
        </div>

        {errorMessage ? <p className="mt-3 text-sm text-destructive">{errorMessage}</p> : null}

        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || !validation.valid || !value.name.trim() || !value.startDate || !value.endDate}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '正在保存配置...' : '保存组合回测配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
