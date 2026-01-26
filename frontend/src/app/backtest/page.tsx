'use client';

import { useQuery } from '@tanstack/react-query';
import { strategyApi } from '@/lib/api';
import type { BacktestResult } from '@/types';
import { BarChart3, TrendingUp, TrendingDown, Target, Clock } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
} from 'recharts';

export default function BacktestPage() {
  const { data: backtestResults, isLoading } = useQuery({
    queryKey: ['backtest-results'],
    queryFn: async () => {
      const results = await Promise.all([
        strategyApi.runBacktest('strategy-1', '2024-01-01', '2024-12-31'),
        strategyApi.runBacktest('strategy-2', '2024-01-01', '2024-12-31'),
      ]);
      return results;
    },
    staleTime: 60000,
  });

  const mockBacktestData: BacktestResult[] = backtestResults || [
    {
      strategy_id: 'strategy-1',
      start_date: '2024-01-01T00:00:00Z',
      end_date: '2024-12-31T00:00:00Z',
      initial_capital: 100000,
      final_capital: 125000,
      total_return: 0.25,
      annualized_return: 0.25,
      sharpe_ratio: 1.8,
      max_drawdown: -0.15,
      win_rate: 0.6,
      total_trades: 150,
      performance_metrics: {
        total_pnl: 25000,
        realized_pnl: 25000,
        unrealized_pnl: 0,
        gross_profit: 40000,
        gross_loss: 15000,
        profit_factor: 2.67,
        average_win: 500,
        average_loss: -300,
        largest_win: 3000,
        largest_loss: -2000,
      },
    },
    {
      strategy_id: 'strategy-2',
      start_date: '2024-01-01T00:00:00Z',
      end_date: '2024-12-31T00:00:00Z',
      initial_capital: 100000,
      final_capital: 115000,
      total_return: 0.15,
      annualized_return: 0.15,
      sharpe_ratio: 1.2,
      max_drawdown: -0.20,
      win_rate: 0.55,
      total_trades: 200,
      performance_metrics: {
        total_pnl: 15000,
        realized_pnl: 15000,
        unrealized_pnl: 0,
        gross_profit: 35000,
        gross_loss: 20000,
        profit_factor: 1.75,
        average_win: 450,
        average_loss: -350,
        largest_win: 2500,
        largest_loss: -2500,
      },
    },
  ];

  const getReturnColor = (value: number) => {
    return value >= 0 ? 'text-green-600' : 'text-red-600';
  };

  const getSharpeColor = (value: number) => {
    if (value > 2) return 'text-green-600';
    if (value > 1) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">回测报告</h1>
        <button className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <BarChart3 className="h-4 w-4 mr-2" />
          运行新回测
        </button>
      </div>

      {isLoading ? (
        <div className="bg-white p-12 rounded-lg shadow">
          <div className="animate-pulse space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {mockBacktestData.map((result: BacktestResult, index) => (
            <div key={index} className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-gray-900">策略 {index + 1}</h3>
                  <div className="flex items-center space-x-2 text-sm text-gray-500">
                    <Clock className="h-4 w-4" />
                    <span>
                      {new Date(result.start_date).toLocaleDateString('zh-CN')} -{' '}
                      {new Date(result.end_date).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">总收益率</span>
                      {result.total_return >= 0 ? (
                        <TrendingUp className="h-5 w-5 text-green-600" />
                      ) : (
                        <TrendingDown className="h-5 w-5 text-red-600" />
                      )}
                    </div>
                    <p className={`text-2xl font-bold ${getReturnColor(result.total_return)}`}>
                      {(result.total_return * 100).toFixed(2)}%
                    </p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">年化收益率</span>
                      <TrendingUp className="h-5 w-5 text-blue-600" />
                    </div>
                    <p className={`text-2xl font-bold ${getReturnColor(result.annualized_return)}`}>
                      {(result.annualized_return * 100).toFixed(2)}%
                    </p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">Sharpe比率</span>
                      <Target className="h-5 w-5 text-purple-600" />
                    </div>
                    <p className={`text-2xl font-bold ${getSharpeColor(result.sharpe_ratio)}`}>
                      {result.sharpe_ratio.toFixed(2)}
                    </p>
                  </div>

                  <div className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">最大回撤</span>
                      <TrendingDown className="h-5 w-5 text-red-600" />
                    </div>
                    <p className="text-2xl font-bold text-red-600">
                      {(result.max_drawdown * 100).toFixed(2)}%
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-base font-medium text-gray-900 mb-4">交易统计</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">总交易次数</span>
                        <span className="font-medium text-gray-900">{result.total_trades}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">胜率</span>
                        <span className={`font-medium ${result.win_rate >= 0.5 ? 'text-green-600' : 'text-red-600'}`}>
                          {(result.win_rate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">初始资金</span>
                        <span className="font-medium text-gray-900">${result.initial_capital.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">最终资金</span>
                        <span className={`font-medium ${result.final_capital >= result.initial_capital ? 'text-green-600' : 'text-red-600'}`}>
                          ${result.final_capital.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-base font-medium text-gray-900 mb-4">盈亏分析</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">总盈亏</span>
                        <span className={`font-medium ${result.performance_metrics.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ${result.performance_metrics.total_pnl.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">盈利因子</span>
                        <span className="font-medium text-gray-900">{result.performance_metrics.profit_factor.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">平均盈利</span>
                        <span className="font-medium text-green-600">
                          ${result.performance_metrics.average_win.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">平均亏损</span>
                        <span className="font-medium text-red-600">
                          ${result.performance_metrics.average_loss.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">最大盈利</span>
                        <span className="font-medium text-green-600">
                          ${result.performance_metrics.largest_win.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">最大亏损</span>
                        <span className="font-medium text-red-600">
                          ${result.performance_metrics.largest_loss.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      {
                        name: '总盈亏',
                        value: result.performance_metrics.total_pnl,
                      },
                      {
                        name: '总盈利',
                        value: result.performance_metrics.gross_profit,
                      },
                      {
                        name: '总亏损',
                        value: -result.performance_metrics.gross_loss,
                      },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="value" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ))}

          {mockBacktestData.length === 0 && (
            <div className="bg-white p-12 rounded-lg shadow text-center">
              <BarChart3 className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">暂无回测结果</h3>
              <p className="text-sm text-gray-500 mb-4">
                运行回测后，结果将显示在这里
              </p>
              <button className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                运行回测
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
