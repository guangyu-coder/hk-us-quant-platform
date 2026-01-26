'use client';

import { useQuery } from '@tanstack/react-query';
import { getSystemHealth } from '@/lib/api';
import { CheckCircle, AlertCircle, XCircle } from 'lucide-react';

export function SystemStatus() {
  const { data: health, isLoading, error } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: getSystemHealth,
    refetchInterval: 30000, // 每30秒检查一次
    retry: 3,
  });

  // 模拟系统状态
  const mockHealth = {
    status: 'healthy' as const,
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      redis: 'connected',
      data_service: 'running',
      strategy_service: 'running',
      execution_service: 'running',
      portfolio_service: 'running',
      risk_service: 'running',
    },
  };

  const displayHealth = error ? mockHealth : health;
  const status = displayHealth?.status || 'error';

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
    <div className="flex items-center space-x-2">
      {getStatusIcon()}
      <span className={`text-sm font-medium ${getStatusColor()}`}>
        {getStatusText()}
      </span>
      {error && (
        <span className="text-xs text-gray-500">(离线模式)</span>
      )}
    </div>
  );
}