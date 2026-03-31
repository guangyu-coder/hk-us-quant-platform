'use client';

import { useQuery } from '@tanstack/react-query';
import { orderApi } from '@/lib/api';
import { formatMarketPrice } from '@/lib/market';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { Order } from '@/types';

export function RecentTrades() {
  const { data: orders, isLoading, error } = useQuery({
    queryKey: ['orders'],
    queryFn: () => orderApi.getOrders(),
    refetchInterval: 5000, // 每5秒刷新一次
  });

  // 确保orders是数组
  const ordersArray: Order[] = Array.isArray(orders) ? orders : 
                     ((orders as any)?.orders ? (orders as any).orders : []);
  
  const recentOrders = ordersArray.slice(0, 10); // 显示最近10笔交易

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Filled':
        return 'bg-green-100 text-green-800';
      case 'PartiallyFilled':
        return 'bg-yellow-100 text-yellow-800';
      case 'Pending':
        return 'bg-blue-100 text-blue-800';
      case 'Cancelled':
        return 'bg-gray-100 text-gray-800';
      case 'Rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'Filled':
        return '已成交';
      case 'PartiallyFilled':
        return '部分成交';
      case 'Pending':
        return '待成交';
      case 'Cancelled':
        return '已取消';
      case 'Rejected':
        return '已拒绝';
      default:
        return status;
    }
  };

  const getSideText = (side: string) => {
    return side === 'Buy' ? '买入' : '卖出';
  };

  const getSideColor = (side: string) => {
    return side === 'Buy' ? 'text-green-600' : 'text-red-600';
  };

  if (isLoading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 mb-4">最近交易</h3>
        <div className="animate-pulse space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center space-x-4">
              <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/6"></div>
              <div className="h-4 bg-gray-200 rounded w-1/6"></div>
              <div className="h-4 bg-gray-200 rounded w-1/4"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-medium text-gray-900 mb-4">最近交易</h3>
      
      {!error && recentOrders.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  股票代码
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  方向
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  数量
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  价格
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  时间
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recentOrders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {order.symbol}
                  </td>
                  <td className={`px-4 py-4 whitespace-nowrap text-sm font-medium ${getSideColor(order.side)}`}>
                    {getSideText(order.side)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                    {order.filled_quantity}/{order.quantity}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatMarketPrice(order.average_fill_price ?? order.price ?? 0, {
                      symbol: order.symbol,
                    })}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(order.status)}`}>
                      {getStatusText(order.status)}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(order.created_at), 'MM-dd HH:mm', { locale: zhCN })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : error ? (
        <div className="text-center py-8 text-gray-500">
          交易记录暂时不可用
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          暂无交易记录
        </div>
      )}

      {error && (
        <div className="mt-4 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          连接服务器失败，未显示模拟交易数据，避免误导
        </div>
      )}
    </div>
  );
}
