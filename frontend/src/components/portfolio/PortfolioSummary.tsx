'use client';

import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/lib/api';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export function PortfolioSummary() {
  const { data: portfolio, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => portfolioApi.getPortfolio(),
    refetchInterval: 10000, // 每10秒刷新一次
  });

  // 模拟持仓数据
  const mockPositions = {
    'AAPL': { symbol: 'AAPL', quantity: 100, market_value: 15000, unrealized_pnl: 500 },
    'GOOGL': { symbol: 'GOOGL', quantity: 50, market_value: 12000, unrealized_pnl: -200 },
    'MSFT': { symbol: 'MSFT', quantity: 80, market_value: 10000, unrealized_pnl: 300 },
    'TSLA': { symbol: 'TSLA', quantity: 30, market_value: 8000, unrealized_pnl: -100 },
  };

  const positions = error ? mockPositions : (portfolio?.positions || {});
  const positionArray = Object.values(positions);

  // 准备饼图数据
  const pieData = positionArray.map((position, index) => ({
    name: position.symbol,
    value: position.market_value,
    color: COLORS[index % COLORS.length],
  }));

  if (isLoading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-4">投资组合</h3>
        <div className="animate-pulse">
          <div className="h-64 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-medium text-gray-900 mb-4">投资组合</h3>
      
      {positionArray.length > 0 ? (
        <>
          <div className="h-64 mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`¥${Number(value).toLocaleString()}`, '市值']} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-3">
            {positionArray.map((position) => (
              <div key={position.symbol} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div>
                  <div className="font-medium text-gray-900">{position.symbol}</div>
                  <div className="text-sm text-gray-500">
                    {position.quantity} 股
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-gray-900">
                    ¥{position.market_value.toLocaleString()}
                  </div>
                  <div className={`text-sm ${
                    position.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {position.unrealized_pnl >= 0 ? '+' : ''}
                    ¥{position.unrealized_pnl.toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-gray-500">
          暂无持仓
        </div>
      )}

      {error && (
        <div className="mt-4 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          连接服务器失败，显示模拟数据
        </div>
      )}
    </div>
  );
}