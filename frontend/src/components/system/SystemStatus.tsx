'use client';

import { useQuery } from '@tanstack/react-query';
import { getSystemHealth, getSystemHealthSummary } from '@/lib/api';
import { CheckCircle, AlertCircle, XCircle } from 'lucide-react';

export function SystemStatus() {
  const { data: health, isLoading, error } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: getSystemHealth,
    refetchInterval: 30000, // 每30秒检查一次
    retry: 3,
  });
  const status = error ? 'error' : (health?.status || 'error');
  const summary = health ? getSystemHealthSummary(health) : null;
  const formatTime = (value?: string | null) => {
    if (!value) {
      return '未知';
    }

    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(time);
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'warning':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'healthy':
        return '系统正常';
      case 'warning':
        return '系统警告';
      case 'error':
        return '系统异常';
      default:
        return '状态未知';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'healthy':
        return 'text-green-600';
      case 'warning':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center space-x-2">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900"></div>
        <span className="text-sm text-gray-600">检查中...</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        {getStatusIcon()}
        <span className={`text-sm font-medium ${getStatusColor()}`}>
          {getStatusText()}
        </span>
        {error && (
          <span className="text-xs text-gray-500">(健康检查不可用)</span>
        )}
      </div>

      <div className="mt-2 grid gap-1 text-xs text-gray-600 sm:grid-cols-2">
        <div>
          <span className="font-medium text-gray-700">最近部署:</span> {formatTime(health?.deployed_at ?? summary?.deployed_at)}
        </div>
        <div>
          <span className="font-medium text-gray-700">最近错误:</span> {health?.recent_error ?? summary?.recent_error ?? '无'}
        </div>
      </div>

      {summary && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-green-50 px-2 py-1 text-green-700">
            策略 {summary.active_strategies}/{summary.strategies_total}
          </span>
          <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">
            订单 {summary.recent_orders}
          </span>
          <span className="rounded-full bg-purple-50 px-2 py-1 text-purple-700">
            回测 {summary.recent_backtests}
          </span>
          <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
            成交 {summary.recent_trades}
          </span>
        </div>
      )}
    </div>
  );
}
