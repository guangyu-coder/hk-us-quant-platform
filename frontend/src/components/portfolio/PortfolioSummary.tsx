'use client';

import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/lib/api';
import { formatMarketPrice, formatPortfolioAmount, formatSignedMarketPrice } from '@/lib/market';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export function PortfolioSummary() {
  const { data: portfolio, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => portfolioApi.getPortfolio(),
    refetchInterval: 10000, // 每10秒刷新一次
  });

  const positions = portfolio?.positions || {};
  const positionArray = Object.values(positions);
  const baseCurrency = portfolio?.base_currency ?? 'USD';
  const isMixedCurrency = baseCurrency === 'MIXED';

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
      {isMixedCurrency && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          当前组合包含多币种持仓，未做汇率折算，以下金额仅作原币种展示。
        </div>
      )}
      
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
                <Tooltip formatter={(value) => [formatPortfolioAmount(Number(value), { currency: baseCurrency }), '市值']} />
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
                    {formatPortfolioAmount(position.market_value, { currency: baseCurrency })}
                  </div>
                  <div className={`text-sm ${
                    position.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {formatSignedMarketPrice(position.unrealized_pnl, { symbol: position.symbol, currency: baseCurrency })}
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
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          组合数据暂时不可用，当前不再回退模拟持仓，请检查后端服务或数据库连接。
        </div>
      )}
    </div>
  );
}
