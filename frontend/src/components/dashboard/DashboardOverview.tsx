'use client';

import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/lib/api';
import { TrendingUp, TrendingDown, DollarSign, Activity } from 'lucide-react';

export function DashboardOverview() {
  const { data: portfolio, isLoading } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => portfolioApi.getPortfolio(),
    refetchInterval: 5000, // 每5秒刷新一次
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-card p-6 rounded-xl shadow-sm border border-border animate-pulse">
            <div className="h-4 bg-secondary rounded w-3/4 mb-3"></div>
            <div className="h-8 bg-secondary rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  const stats = [
    {
      name: '总资产',
      value: portfolio?.total_value ? `¥${portfolio.total_value.toLocaleString()}` : '¥0',
      change: portfolio?.unrealized_pnl || 0,
      changeType: (portfolio?.unrealized_pnl || 0) >= 0 ? 'positive' : 'negative',
      icon: DollarSign,
    },
    {
      name: '现金余额',
      value: portfolio?.cash_balance ? `¥${portfolio.cash_balance.toLocaleString()}` : '¥0',
      change: 0,
      changeType: 'neutral' as const,
      icon: Activity,
    },
    {
      name: '未实现盈亏',
      value: portfolio?.unrealized_pnl ? `¥${portfolio.unrealized_pnl.toLocaleString()}` : '¥0',
      change: portfolio?.unrealized_pnl || 0,
      changeType: (portfolio?.unrealized_pnl || 0) >= 0 ? 'positive' : 'negative',
      icon: (portfolio?.unrealized_pnl || 0) >= 0 ? TrendingUp : TrendingDown,
    },
    {
      name: '已实现盈亏',
      value: portfolio?.realized_pnl ? `¥${portfolio.realized_pnl.toLocaleString()}` : '¥0',
      change: portfolio?.realized_pnl || 0,
      changeType: (portfolio?.realized_pnl || 0) >= 0 ? 'positive' : 'negative',
      icon: (portfolio?.realized_pnl || 0) >= 0 ? TrendingUp : TrendingDown,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat) => (
        <div key={stat.name} className="bg-card text-card-foreground p-6 rounded-xl shadow-sm border border-border transition-all hover:shadow-md">
          <div className="flex items-center">
            <div className={`flex-shrink-0 p-3 rounded-lg ${
                  stat.changeType === 'positive'
                    ? 'bg-success/10 text-success'
                    : stat.changeType === 'negative'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-secondary text-muted-foreground'
                }`}>
              <stat.icon className="h-6 w-6" />
            </div>
            <div className="ml-4 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-muted-foreground truncate">
                  {stat.name}
                </dt>
                <dd className="text-2xl font-bold text-foreground mt-1">
                  {stat.value}
                </dd>
              </dl>
            </div>
          </div>
          {stat.change !== 0 && (
            <div className="mt-4">
              <div
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  stat.changeType === 'positive'
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {stat.changeType === 'positive' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                {stat.changeType === 'positive' ? '+' : ''}
                {stat.change.toLocaleString()}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}