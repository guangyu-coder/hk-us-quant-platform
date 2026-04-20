'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { portfolioBacktestApi, getApiErrorMessage } from '@/lib/api';
import type { PortfolioBacktestConfigListItem } from '@/types';
import {
  formatPortfolioCurrency,
  formatPortfolioDate,
  formatRebalancingFrequencyLabel,
} from './portfolio-backtest-helpers';
import { useState } from 'react';
import { PlayCircle, PlusCircle } from 'lucide-react';

export default function PortfolioBacktestPage() {
  const router = useRouter();
  const [runningConfigId, setRunningConfigId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: configs = [], isLoading, refetch } = useQuery({
    queryKey: ['portfolio-backtest-configs'],
    queryFn: () => portfolioBacktestApi.listConfigs(),
    staleTime: 60000,
  });

  const runConfig = async (configId: string) => {
    try {
      setRunningConfigId(configId);
      setErrorMessage(null);
      const report = await portfolioBacktestApi.runConfig(configId);
      router.push(`/portfolio-backtest/runs/${report.run.id}`);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, '组合回测启动失败'));
    } finally {
      setRunningConfigId(null);
      void refetch();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Portfolio Backtest
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">组合回测</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            固定权重、多标的、周期再平衡。先把组合级收益、回撤和调仓记录跑通，再往研究深度继续扩。
          </p>
        </div>

        <Link
          href="/portfolio-backtest/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
        >
          <PlusCircle className="h-4 w-4" />
          新建组合回测
        </Link>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="配置数量" value={`${configs.length}`} />
        <SummaryCard
          label="启用配置"
          value={`${configs.filter((config) => config.is_active).length}`}
        />
        <SummaryCard
          label="最近更新"
          value={configs[0] ? formatPortfolioDate(configs[0].updated_at) : '--'}
        />
      </div>

      <section className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">组合配置列表</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            先保存配置，再从列表直接触发回测，进入组合级报告页。
          </p>
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">正在加载组合配置...</div>
        ) : configs.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            还没有组合回测配置，先创建第一组固定权重组合。
          </div>
        ) : (
          <div className="divide-y divide-border">
            {configs.map((config) => (
              <ConfigRow
                key={config.id}
                config={config}
                running={runningConfigId === config.id}
                onRun={() => void runConfig(config.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function ConfigRow({
  config,
  onRun,
  running,
}: {
  config: PortfolioBacktestConfigListItem;
  onRun: () => void;
  running: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold text-foreground">{config.name}</h3>
          <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
            {config.asset_count} 个标的
          </span>
          <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
            {formatRebalancingFrequencyLabel(config.rebalancing_frequency)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {config.description || '当前配置未填写额外说明。'}
        </p>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>资金 {formatPortfolioCurrency(config.initial_capital)}</span>
          <span>区间 {config.start_date} ~ {config.end_date}</span>
          <span>更新于 {formatPortfolioDate(config.updated_at)}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          <PlayCircle className="h-4 w-4" />
          {running ? '运行中...' : '运行组合回测'}
        </button>
      </div>
    </div>
  );
}
