'use client';

import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/lib/api';
import type { Portfolio, Position } from '@/types';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Wallet } from 'lucide-react';

// 模拟历史盈亏数据
const mockPnLData = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  unrealized_pnl: 10000 + Math.random() * 5000 - 2500,
  realized_pnl: 5000 + i * 100 + Math.random() * 500 - 250,
}));

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function PortfolioPage() {
  const { data: portfolio, isLoading } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => portfolioApi.getPortfolio(),
    refetchInterval: 5000,
  });

  const positions = portfolio?.positions ? Object.values(portfolio.positions) : [];

  // 计算资产分布数据
  const distributionData = positions.length > 0
    ? positions.map((pos) => ({
        name: pos.symbol,
        value: pos.market_value,
      }))
    : [{ name: '现金', value: portfolio?.cash_balance || 0 }];

  // 计算总盈亏
  const totalUnrealizedPnL = positions.reduce((sum, pos) => sum + pos.unrealized_pnl, 0);
  const totalRealizedPnL = portfolio?.realized_pnl || 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">投资组合管理</h1>
      </div>

      {/* 组合概览卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">组合总价值</p>
              <p className="text-2xl font-bold text-gray-900">
                ${portfolio?.total_value?.toFixed(2) || '0.00'}
              </p>
            </div>
            <Wallet className="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">现金余额</p>
              <p className="text-2xl font-bold text-gray-900">
                ${portfolio?.cash_balance?.toFixed(2) || '0.00'}
              </p>
            </div>
            <DollarSign className="h-8 w-8 text-green-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">未实现盈亏</p>
              <p className={`text-2xl font-bold ${totalUnrealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totalUnrealizedPnL >= 0 ? '+' : ''}${totalUnrealizedPnL.toFixed(2)}
              </p>
            </div>
            {totalUnrealizedPnL >= 0 ? (
              <TrendingUp className="h-8 w-8 text-green-600" />
            ) : (
              <TrendingDown className="h-8 w-8 text-red-600" />
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">已实现盈亏</p>
              <p className={`text-2xl font-bold ${totalRealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totalRealizedPnL >= 0 ? '+' : ''}${totalRealizedPnL.toFixed(2)}
              </p>
            </div>
            <Wallet className="h-8 w-8 text-purple-600" />
          </div>
        </div>
      </div>

      {/* 持仓详情和资产分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 持仓表格 */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">持仓详情</h3>
          </div>

          {isLoading ? (
            <div className="p-6">
              <div className="animate-pulse space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-gray-200 rounded"></div>
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      代码
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      数量
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      成本价
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      市值
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      未实现盈亏
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {positions.map((position: Position) => (
                    <tr key={position.symbol} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {position.symbol}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {position.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${position.average_cost.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${position.market_value.toFixed(2)}
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                        position.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {position.unrealized_pnl >= 0 ? '+' : ''}${position.unrealized_pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {positions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-500">
                        暂无持仓
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 资产分布饼图 */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-900 mb-4">资产分布</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distributionData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {distributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* 资产分布列表 */}
          <div className="mt-4 space-y-2">
            {distributionData.map((item, index) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <div
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  ></div>
                  <span className="text-gray-900">{item.name}</span>
                </div>
                <span className="font-medium text-gray-900">${item.value.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 盈亏趋势图 */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-4">盈亏趋势</h3>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mockPnLData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="unrealized_pnl"
                stroke="#3b82f6"
                strokeWidth={2}
                name="未实现盈亏"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="realized_pnl"
                stroke="#10b981"
                strokeWidth={2}
                name="已实现盈亏"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
