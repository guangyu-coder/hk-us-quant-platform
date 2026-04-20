'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getApiErrorMessage, portfolioBacktestApi } from '@/lib/api';
import { PortfolioBacktestReport as PortfolioBacktestReportView } from '../../_components/PortfolioBacktestReport';

export default function PortfolioBacktestRunPage() {
  const params = useParams<{ runId: string }>();
  const runId = Array.isArray(params?.runId) ? params.runId[0] : params?.runId;

  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio-backtest-run', runId],
    queryFn: () => portfolioBacktestApi.getRun(runId as string),
    enabled: Boolean(runId),
    staleTime: 60000,
  });

  if (!runId) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        缺少组合回测运行 ID。
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">正在加载组合回测报告...</div>;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {getApiErrorMessage(error, '组合回测报告加载失败')}
        </div>
        <Link
          href="/portfolio-backtest"
          className="inline-flex rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground"
        >
          返回组合回测列表
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/portfolio-backtest"
          className="inline-flex rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground"
        >
          返回组合回测列表
        </Link>
      </div>
      <PortfolioBacktestReportView report={data} />
    </div>
  );
}
