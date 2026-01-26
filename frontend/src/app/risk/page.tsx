'use client';

import { useQuery } from '@tanstack/react-query';
import { riskApi, portfolioApi } from '@/lib/api';
import type { RiskMetrics } from '@/types';
import { Shield, AlertTriangle, TrendingDown, Activity } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

export default function RiskPage() {
  const { data: riskMetrics, isLoading: riskLoading } = useQuery({
    queryKey: ['risk-metrics'],
    queryFn: () => riskApi.getRiskMetrics(),
    refetchInterval: 10000,
  });

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => portfolioApi.getPortfolio(),
    refetchInterval: 5000,
  });

  const mockRiskHistory = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    var_1d: 1000 + Math.random() * 2000 - 1000,
    leverage: 1.5 + Math.random() * 1,
    exposure: (portfolio?.total_value || 0) * (1.5 + Math.random() * 1),
  }));

  const mockAlerts = [
    {
      id: '1',
      type: 'warning',
      message: '单股票持仓超过10%',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      severity: 'medium',
    },
    {
      id: '2',
      type: 'info',
      message: 'VaR在正常范围内',
      timestamp: new Date(Date.now() - 7200000).toISOString(),
      severity: 'low',
    },
    {
      id: '3',
      type: 'error',
      message: '日内亏损接近上限',
      timestamp: new Date(Date.now() - 10800000).toISOString(),
      severity: 'high',
    },
  ];

  const getAlertColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getLeverageColor = (leverage: number) => {
    if (leverage > 3) return 'text-red-600';
    if (leverage > 2) return 'text-yellow-600';
    return 'text-green-600';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">风险管理</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">组合价值</p>
              <p className="text-2xl font-bold text-gray-900">
                ${riskMetrics?.portfolio_value?.toFixed(2) || '0.00'}
              </p>
            </div>
            <Shield className="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">总敞口</p>
              <p className="text-2xl font-bold text-gray-900">
                ${riskMetrics?.total_exposure?.toFixed(2) || '0.00'}
              </p>
            </div>
            <Activity className="h-8 w-8 text-purple-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">杠杆比率</p>
              <p className={`text-2xl font-bold ${getLeverageColor(riskMetrics?.leverage || 0)}`}>
                {riskMetrics?.leverage?.toFixed(2) || '0.00'}x
              </p>
            </div>
            <TrendingDown className="h-8 w-8 text-orange-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">VaR (1日)</p>
              <p className="text-2xl font-bold text-gray-900">
                ${riskMetrics?.var_1d?.toFixed(2) || '0.00'}
              </p>
            </div>
            <AlertTriangle className="h-8 w-8 text-red-600" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">风险指标详情</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <span className="text-sm text-gray-500">最大回撤</span>
                <span className="font-medium text-gray-900">
                  {riskMetrics?.max_drawdown ? `${(riskMetrics.max_drawdown * 100).toFixed(2)}%` : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <span className="text-sm text-gray-500">Sharpe比率</span>
                <span className="font-medium text-gray-900">
                  {riskMetrics?.sharpe_ratio?.toFixed(3) || 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <span className="text-sm text-gray-500">风险敞口占比</span>
                <span className="font-medium text-gray-900">
                  {riskMetrics && portfolio ? `${((riskMetrics.total_exposure / portfolio.total_value) * 100).toFixed(1)}%` : '0%'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">上次计算时间</span>
                <span className="font-medium text-gray-900">
                  {riskMetrics?.calculated_at ? new Date(riskMetrics.calculated_at).toLocaleString('zh-CN') : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">风险限额设置</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700">最大杠杆</span>
                <span className="font-medium text-gray-900">3.0x</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700">单股票权重上限</span>
                <span className="font-medium text-gray-900">10%</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700">日内最大亏损</span>
                <span className="font-medium text-gray-900">$50,000</span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">风险趋势</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mockRiskHistory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="var_1d"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.3}
                    name="VaR (1日)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">风险告警</h3>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {mockAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-lg border ${getAlertColor(alert.severity)}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium mb-1">{alert.message}</p>
                      <p className="text-xs text-gray-600">
                        {new Date(alert.timestamp).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      alert.severity === 'high' ? 'bg-red-200' :
                      alert.severity === 'medium' ? 'bg-yellow-200' : 'bg-blue-200'
                    }`}>
                      {alert.severity === 'high' ? '高' : alert.severity === 'medium' ? '中' : '低'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
