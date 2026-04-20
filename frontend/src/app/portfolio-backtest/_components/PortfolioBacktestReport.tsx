'use client';

import type { PortfolioBacktestReport } from '@/types';
import {
  formatPortfolioCurrency,
  formatPortfolioDate,
  formatPortfolioPercentage,
  formatRebalancingFrequencyLabel,
} from '../portfolio-backtest-helpers';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';

type PortfolioBacktestReportProps = {
  report: PortfolioBacktestReport;
};

export function PortfolioBacktestReport({ report }: PortfolioBacktestReportProps) {
  const chartData = report.equity_curve.map((point) => ({
    date: point.trading_date,
    totalValue: point.total_value,
    drawdown: point.drawdown != null ? Number((point.drawdown * 100).toFixed(2)) : null,
  }));

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
              组合回测报告
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-foreground">{report.config.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {report.config.description || '当前配置未填写额外说明。'}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background/50 px-4 py-3 text-sm">
            <p className="text-muted-foreground">运行状态</p>
            <p className="mt-1 font-medium text-foreground">{report.run.status}</p>
            <p className="mt-2 text-muted-foreground">完成时间</p>
            <p className="mt-1 font-medium text-foreground">
              {formatPortfolioDate(report.run.completed_at ?? report.run.started_at)}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard title="初始资金" value={formatPortfolioCurrency(report.run.initial_capital)} />
          <MetricCard title="最终资金" value={formatPortfolioCurrency(report.run.final_capital ?? null)} />
          <MetricCard title="总收益率" value={formatPortfolioPercentage(report.run.total_return ?? null, 2)} />
          <MetricCard title="最大回撤" value={formatPortfolioPercentage(report.run.max_drawdown ?? null, 2)} />
          <MetricCard title="Sharpe" value={formatNullableNumber(report.run.sharpe_ratio)} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-2xl border border-border bg-card p-6 xl:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">权益曲线</h2>
              <p className="text-sm text-muted-foreground">展示组合总资产随时间的变化。</p>
            </div>
          </div>
          <div className="mt-6 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="totalValue" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">配置摘要</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <SummaryRow label="再平衡频率" value={formatRebalancingFrequencyLabel(report.config.rebalancing_frequency)} />
            <SummaryRow label="回测区间" value={`${report.config.start_date} ~ ${report.config.end_date}`} />
            <SummaryRow label="手续费" value={`${report.config.fee_bps} bps`} />
            <SummaryRow label="滑点" value={`${report.config.slippage_bps} bps`} />
            <SummaryRow label="标的数量" value={`${report.config.assets.length} 个`} />
          </dl>

          <div className="mt-6 rounded-xl border border-border bg-background/50 p-4">
            <p className="text-sm font-medium text-foreground">目标权重</p>
            <div className="mt-3 space-y-2">
              {report.config.assets.map((asset) => (
                <div key={`${asset.market}-${asset.symbol}`} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-foreground">{asset.display_name}</p>
                    <p className="text-muted-foreground">
                      {asset.symbol} · {asset.market} · {asset.instrument_type}
                    </p>
                  </div>
                  <span className="font-medium text-foreground">
                    {formatPortfolioPercentage(asset.target_weight)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">持仓快照</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2">日期</th>
                <th className="px-3 py-2">标的</th>
                <th className="px-3 py-2">数量</th>
                <th className="px-3 py-2">价格</th>
                <th className="px-3 py-2">市值</th>
                <th className="px-3 py-2">权重</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.holdings.slice(0, 20).map((holding) => (
                <tr key={holding.id}>
                  <td className="px-3 py-2 text-foreground">{holding.holding_date}</td>
                  <td className="px-3 py-2 text-foreground">{holding.symbol}</td>
                  <td className="px-3 py-2 text-foreground">{holding.quantity.toFixed(4)}</td>
                  <td className="px-3 py-2 text-foreground">{formatPortfolioCurrency(holding.price)}</td>
                  <td className="px-3 py-2 text-foreground">{formatPortfolioCurrency(holding.market_value)}</td>
                  <td className="px-3 py-2 text-foreground">{formatPortfolioPercentage(holding.weight)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">调仓记录</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2">日期</th>
                <th className="px-3 py-2">标的</th>
                <th className="px-3 py-2">动作</th>
                <th className="px-3 py-2">目标权重</th>
                <th className="px-3 py-2">成交金额</th>
                <th className="px-3 py-2">手续费</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.rebalances.map((rebalance) => (
                <tr key={rebalance.id}>
                  <td className="px-3 py-2 text-foreground">{rebalance.rebalance_date}</td>
                  <td className="px-3 py-2 text-foreground">{rebalance.symbol}</td>
                  <td className="px-3 py-2 text-foreground">{rebalance.action}</td>
                  <td className="px-3 py-2 text-foreground">{formatPortfolioPercentage(rebalance.target_weight)}</td>
                  <td className="px-3 py-2 text-foreground">{formatPortfolioCurrency(rebalance.trade_value)}</td>
                  <td className="px-3 py-2 text-foreground">{formatPortfolioCurrency(rebalance.fee_cost + rebalance.slippage_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function formatNullableNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return value.toFixed(2);
}
