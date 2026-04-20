'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getApiErrorMessage, portfolioBacktestApi } from '@/lib/api';
import {
  buildPortfolioBacktestPayload,
  createEmptyPortfolioAsset,
  PortfolioBacktestForm,
  type PortfolioBacktestFormValues,
} from '../_components/PortfolioBacktestForm';

const DEFAULT_FORM: PortfolioBacktestFormValues = {
  name: '',
  description: '',
  initialCapital: 100000,
  feeBps: 5,
  slippageBps: 2,
  rebalancingFrequency: 'monthly',
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  isActive: true,
  assets: [
    {
      symbol: 'AAPL',
      displayName: 'Apple',
      market: 'US',
      instrumentType: 'Common Stock',
      targetWeight: 0.5,
    },
    {
      symbol: 'MSFT',
      displayName: 'Microsoft',
      market: 'US',
      instrumentType: 'Common Stock',
      targetWeight: 0.5,
    },
  ],
};

export default function NewPortfolioBacktestPage() {
  const router = useRouter();
  const [value, setValue] = useState<PortfolioBacktestFormValues>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      setErrorMessage(null);
      const payload = buildPortfolioBacktestPayload(value);
      await portfolioBacktestApi.createConfig(payload);
      router.push('/portfolio-backtest');
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, '组合配置保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Portfolio Backtest
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">新建组合回测</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            先把组合权重、市场范围和再平衡频率锁清楚，这一版只支持同市场固定权重组合。
          </p>
        </div>
        <Link
          href="/portfolio-backtest"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground"
        >
          返回列表
        </Link>
      </div>

      <PortfolioBacktestForm
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        submitting={submitting}
        errorMessage={errorMessage}
      />

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">起步建议</p>
        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
          <li>先从 2-5 个标的开始，避免第一版组合过大难以核对。</li>
          <li>权重请严格加总到 100%，例如 `0.5 + 0.3 + 0.2`。</li>
          <li>如果你想重置成空白配置，可以把资产行逐个删除后再用右上角继续添加。</li>
        </ul>
        <button
          type="button"
          onClick={() =>
            setValue({
              ...DEFAULT_FORM,
              name: '',
              description: '',
              assets: [createEmptyPortfolioAsset(), createEmptyPortfolioAsset()],
            })
          }
          className="mt-4 rounded-lg border border-border px-3 py-2 text-sm text-foreground"
        >
          重置为两行空白资产
        </button>
      </div>
    </div>
  );
}
