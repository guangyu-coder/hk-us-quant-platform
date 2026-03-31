'use client';

import { useQuery } from '@tanstack/react-query';
import { riskApi, portfolioApi } from '@/lib/api';
import type { Position } from '@/types';
import { formatMarketPrice, formatPortfolioAmount, formatMarketTimestamp } from '@/lib/market';
import { Shield, AlertTriangle, TrendingDown, Activity } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function RiskPage() {
  const { data: riskMetrics, isLoading: riskLoading } = useQuery({
    queryKey: ['risk-metrics'],
    queryFn: () => riskApi.getRiskMetrics(),
    refetchInterval: 10000,
  });
  const { data: riskLimits } = useQuery({
    queryKey: ['risk-limits'],
    queryFn: () => riskApi.getRiskLimits(),
    refetchInterval: 30000,
  });

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => portfolioApi.getPortfolio(),
    refetchInterval: 5000,
  });
  const { data: alerts = [], isLoading: alertsLoading, error: alertsError } = useQuery({
    queryKey: ['risk-alerts'],
    queryFn: () => riskApi.getRiskAlerts(),
    refetchInterval: 10000,
  });

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

  const baseCurrency = riskMetrics?.base_currency ?? portfolio?.base_currency ?? 'USD';
  const isMixedCurrency = baseCurrency === 'MIXED';
  const exposureData = portfolio?.positions
    ? Object.values(portfolio.positions)
        .map((position: Position) => ({
          symbol: position.symbol,
          exposure: position.market_value,
        }))
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 6)
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">风险管理</h1>
      </div>

      {isMixedCurrency && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          当前组合包含多币种持仓，风险指标未做汇率折算。总值和敞口按原币种口径展示，避免误标成美元。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">组合价值</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatPortfolioAmount(riskMetrics?.portfolio_value, { currency: baseCurrency, fallback: '$0.00' })}
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
                {formatPortfolioAmount(riskMetrics?.total_exposure, { currency: baseCurrency, fallback: '$0.00' })}
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
                {formatPortfolioAmount(riskMetrics?.var_1d, { currency: baseCurrency, fallback: '$0.00' })}
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
                <span className="text-sm text-gray-700">最大订单数量</span>
                <span className="font-medium text-gray-900">
                  {riskLimits?.max_order_size ?? 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700">最大杠杆</span>
                <span className="font-medium text-gray-900">
                  {riskLimits ? `${riskLimits.max_leverage.toFixed(1)}x` : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700">单股票权重上限</span>
                <span className="font-medium text-gray-900">
                  {riskLimits?.max_single_stock_weight !== null && riskLimits?.max_single_stock_weight !== undefined
                    ? `${(riskLimits.max_single_stock_weight * 100).toFixed(1)}%`
                    : '未配置'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700">日内最大亏损</span>
                <span className="font-medium text-gray-900">
                  {riskLimits?.max_daily_loss !== null && riskLimits?.max_daily_loss !== undefined
                    ? formatPortfolioAmount(riskLimits.max_daily_loss, { currency: baseCurrency })
                    : '未配置'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700">风险检查</span>
                <span className="font-medium text-gray-900">
                  {riskLimits?.risk_check_enabled ? '启用' : '关闭'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700">Paper Trading</span>
                <span className="font-medium text-gray-900">
                  {riskLimits?.paper_trading ? '启用' : '关闭'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">当前风险敞口</h3>
            <div className="h-64">
              {exposureData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={exposureData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="symbol" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatMarketPrice(value, { currency: baseCurrency })} />
                    <Bar dataKey="exposure" fill="#3b82f6" name="持仓敞口" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
                  暂无可用持仓，当前无法生成真实风险敞口图。
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">风险告警</h3>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {alertsLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, index) => (
                    <div key={index} className="h-20 animate-pulse rounded bg-gray-100" />
                  ))}
                </div>
              ) : alerts.length > 0 ? (
                alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-lg border ${getAlertColor(alert.severity.toLowerCase())}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="mb-1 text-sm font-medium">{alert.message}</p>
                        <p className="text-xs text-gray-600">
                          {alert.alert_type} · {formatMarketTimestamp(alert.created_at)}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        alert.severity === 'HIGH' || alert.severity === 'CRITICAL' ? 'bg-red-200' :
                        alert.severity === 'MEDIUM' ? 'bg-yellow-200' : 'bg-blue-200'
                      }`}>
                        {alert.severity}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
                  {alertsError
                    ? '风险告警接口不可用，当前不再展示模拟告警。'
                    : `暂无真实风险告警记录。最近一次风险计算时间：${formatMarketTimestamp(riskMetrics?.calculated_at, '暂无')}`}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
