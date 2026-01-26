'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orderApi } from '@/lib/api';
import { Plus, X } from 'lucide-react';
import type { Order, OrderSide, OrderType } from '@/types';

export default function TradingPage() {
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [orderForm, setOrderForm] = useState({
    symbol: '',
    side: 'Buy' as OrderSide,
    quantity: '',
    price: '',
    order_type: 'Market' as OrderType,
    time_in_force: 'Day',
    stop_price: '',
    extended_hours: false,
  });

  const queryClient = useQueryClient();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => orderApi.getOrders(),
    refetchInterval: 5000,
  });

  const createOrderMutation = useMutation({
    mutationFn: orderApi.createOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setShowOrderForm(false);
      setOrderForm({
        symbol: '',
        side: 'Buy',
        quantity: '',
        price: '',
        order_type: 'Market',
        time_in_force: 'Day',
        stop_price: '',
        extended_hours: false,
      });
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: orderApi.cancelOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const handleSubmitOrder = (e: React.FormEvent) => {
    e.preventDefault();
    createOrderMutation.mutate({
      symbol: orderForm.symbol,
      side: orderForm.side,
      quantity: parseInt(orderForm.quantity),
      price: orderForm.order_type === 'Market' ? undefined : parseFloat(orderForm.price),
      order_type: orderForm.order_type,
      time_in_force: orderForm.time_in_force,
      stop_price: orderForm.stop_price ? parseFloat(orderForm.stop_price) : undefined,
      extended_hours: orderForm.extended_hours,
    });
  };

  const handleCancelOrder = (orderId: string) => {
    if (confirm('确定要取消这个订单吗？')) {
      cancelOrderMutation.mutate(orderId);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Filled':
        return 'bg-green-100 text-green-800';
      case 'PartiallyFilled':
        return 'bg-yellow-100 text-yellow-800';
      case 'Pending':
        return 'bg-blue-100 text-blue-800';
      case 'Submitted':
        return 'bg-purple-100 text-purple-800';
      case 'Cancelled':
        return 'bg-gray-100 text-gray-800';
      case 'Rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      'Filled': '已成交',
      'PartiallyFilled': '部分成交',
      'Pending': '待成交',
      'Submitted': '已提交',
      'Cancelled': '已取消',
      'Rejected': '已拒绝',
    };
    return statusMap[status] || status;
  };

  // 确保orders是数组
  const ordersArray = Array.isArray(orders) ? orders : 
                     ((orders as any)?.orders ? (orders as any).orders : []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">交易执行</h1>
        <button
          onClick={() => setShowOrderForm(true)}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          新建订单
        </button>
      </div>

      {/* 订单表单弹窗 */}
      {showOrderForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">新建订单</h3>
              <button
                onClick={() => setShowOrderForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitOrder} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  股票代码
                </label>
                <input
                  type="text"
                  value={orderForm.symbol}
                  onChange={(e) => setOrderForm({ ...orderForm, symbol: e.target.value.toUpperCase() })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="例如: AAPL"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  交易方向
                </label>
                <select
                  value={orderForm.side}
                  onChange={(e) => setOrderForm({ ...orderForm, side: e.target.value as OrderSide })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="Buy">买入</option>
                  <option value="Sell">卖出</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  数量
                </label>
                <input
                  type="number"
                  value={orderForm.quantity}
                  onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="100"
                  min="1"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  订单类型
                </label>
                <select
                  value={orderForm.order_type}
                  onChange={(e) => setOrderForm({ ...orderForm, order_type: e.target.value as OrderType })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="Market">市价单 (Market)</option>
                  <option value="Limit">限价单 (Limit)</option>
                  <option value="Stop">止损单 (Stop)</option>
                  <option value="StopLimit">止损限价单 (Stop Limit)</option>
                </select>
              </div>

              {(orderForm.order_type === 'Limit' || orderForm.order_type === 'StopLimit') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    价格
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={orderForm.price}
                    onChange={(e) => setOrderForm({ ...orderForm, price: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="150.00"
                    required
                  />
                </div>
              )}

              {(orderForm.order_type === 'Stop' || orderForm.order_type === 'StopLimit') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    止损触发价
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={orderForm.stop_price}
                    onChange={(e) => setOrderForm({ ...orderForm, stop_price: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="145.00"
                    required
                  />
                </div>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
                >
                  {showAdvanced ? '隐藏高级选项' : '显示高级选项'}
                </button>
              </div>

              {showAdvanced && (
                <div className="space-y-4 pt-2 border-t border-gray-100">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      有效期 (Time in Force)
                    </label>
                    <select
                      value={orderForm.time_in_force}
                      onChange={(e) => setOrderForm({ ...orderForm, time_in_force: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="Day">当日有效 (Day)</option>
                      <option value="GTC">撤销前有效 (GTC)</option>
                      <option value="IOC">即时成交或取消 (IOC)</option>
                      <option value="FOK">全部成交或取消 (FOK)</option>
                    </select>
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="extended_hours"
                      checked={orderForm.extended_hours}
                      onChange={(e) => setOrderForm({ ...orderForm, extended_hours: e.target.checked })}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                    />
                    <label htmlFor="extended_hours" className="ml-2 text-sm text-gray-700">
                      允许盘前盘后交易
                    </label>
                  </div>
                </div>
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowOrderForm(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createOrderMutation.isPending}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {createOrderMutation.isPending ? '提交中...' : '提交订单'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 订单列表 */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">订单列表</h3>
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
                    股票代码
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    方向
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    类型
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    数量
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    价格
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {ordersArray.map((order: Order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {order.symbol}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                      order.side === 'Buy' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {order.side === 'Buy' ? '买入' : '卖出'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {order.order_type === 'Market' ? '市价' : '限价'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {order.filled_quantity}/{order.quantity}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${order.price?.toFixed(2) || 'Market'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(order.status)}`}>
                        {getStatusText(order.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {(order.status === 'Pending' || order.status === 'Submitted') && (
                        <button
                          onClick={() => handleCancelOrder(order.id)}
                          disabled={cancelOrderMutation.isPending}
                          className="text-red-600 hover:text-red-900 disabled:opacity-50"
                        >
                          取消
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}