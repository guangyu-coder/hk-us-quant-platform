'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orderApi, strategyApi } from '@/lib/api';
import { formatMarketPrice, formatMarketTimestamp } from '@/lib/market';
import { Activity, ChevronRight, Clock3, Plus, Radar, X } from 'lucide-react';
import type {
  CreateOrderResult,
  Order,
  OrderAuditEntry,
  OrderSide,
  OrderType,
  PaperSimulationResult,
  StrategyConfig,
  StrategyExecutionOverview,
} from '@/types';
import { deriveTradingOrderCounts, normalizeOrdersCollection, selectTradingOrderId } from './trading-helpers';

export default function TradingPage() {
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderFeedback, setOrderFeedback] = useState<CreateOrderResult | null>(null);
  const [simulationFeedback, setSimulationFeedback] = useState<PaperSimulationResult | null>(null);
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

  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => strategyApi.getStrategies(),
    staleTime: 60000,
  });

  const trackedStrategies = useMemo(
    () => strategies.filter((strategy: StrategyConfig) => strategy.is_active).slice(0, 6),
    [strategies]
  );

  const { data: strategyStates = [] } = useQuery({
    queryKey: ['strategy-state-overview', trackedStrategies.map((strategy) => strategy.id)],
    queryFn: () => Promise.all(trackedStrategies.map((strategy) => strategyApi.getStrategyState(strategy.id))),
    enabled: trackedStrategies.length > 0,
    staleTime: 30000,
  });

  const createOrderMutation = useMutation({
    mutationFn: orderApi.createOrder,
    onSuccess: (result) => {
      setOrderFeedback(result);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-pnl-report'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-pnl-history'] });
      queryClient.invalidateQueries({ queryKey: ['risk-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['risk-alerts'] });
      if (result.accepted) {
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
      }
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: orderApi.cancelOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['risk-metrics'] });
    },
  });

  const simulateOrdersMutation = useMutation({
    mutationFn: () => orderApi.simulateOrders(),
    onSuccess: (result) => {
      setSimulationFeedback(result);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-pnl-report'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-pnl-history'] });
      queryClient.invalidateQueries({ queryKey: ['risk-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['risk-alerts'] });
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

  const getOrderTypeText = (orderType: OrderType) => {
    switch (orderType) {
      case 'Market':
        return '市价';
      case 'Limit':
        return '限价';
      case 'Stop':
        return '止损';
      case 'StopLimit':
        return '止损限价';
      default:
        return orderType;
    }
  };

  const ordersArray = useMemo(() => normalizeOrdersCollection(orders), [orders]);

  useEffect(() => {
    const nextSelectedOrderId = selectTradingOrderId(ordersArray, selectedOrderId);
    if (nextSelectedOrderId !== selectedOrderId) {
      setSelectedOrderId(nextSelectedOrderId);
    }
  }, [ordersArray, selectedOrderId]);

  const selectedOrder = ordersArray.find((order: Order) => order.id === selectedOrderId) ?? ordersArray[0] ?? null;
  const selectedSimulation = simulationFeedback?.results.find((result) => result.order_id === selectedOrder?.id) ?? null;
  const { data: selectedOrderAudit } = useQuery({
    queryKey: ['order-audit', selectedOrder?.id],
    queryFn: () => orderApi.getOrderAudit(selectedOrder!.id),
    enabled: !!selectedOrder?.id,
    refetchInterval: 15000,
  });
  const filledRatio = selectedOrder && selectedOrder.quantity > 0
    ? Math.min(100, Math.round((selectedOrder.filled_quantity / selectedOrder.quantity) * 100))
    : 0;
  const { open: openOrdersCount, partiallyFilled: partiallyFilledCount, filled: filledCount, terminal: terminalCount } =
    deriveTradingOrderCounts(ordersArray);

  const strategyStateCards = useMemo(() => {
    const stateById = new Map(strategyStates.map((state) => [state.strategy_id, state]));
    return trackedStrategies.map((strategy) => ({
      strategy,
      state: stateById.get(strategy.id) ?? null,
    }));
  }, [strategyStates, trackedStrategies]);

  const formatCompactDateTime = (value?: string | null): string => {
    if (!value) {
      return '暂无';
    }

    return new Date(value).toLocaleString('zh-CN');
  };

  const formatSignalStatus = (recentSignal: StrategyExecutionOverview['recent_signal']): string => {
    if (recentSignal.signal_type) {
      return `${recentSignal.signal_type} / ${Math.round((recentSignal.strength ?? 0) * 100)}%`;
    }

    if (recentSignal.confirmation_state === 'manual_review_only') {
      return '人工复核预留中';
    }

    return recentSignal.status;
  };

  const getLifecycleStep = (order: Order): string => {
    switch (order.status) {
      case 'Pending':
        return '待提交';
      case 'Submitted':
        return '已进入撮合';
      case 'PartiallyFilled':
        return '部分成交，等待剩余数量';
      case 'Filled':
        return '已完全成交';
      case 'Cancelled':
        return '已取消';
      case 'Rejected':
        return '已拒绝';
      default:
        return order.status;
    }
  };

  const getOrderTypeHint = (order: Order): string => {
    switch (order.order_type) {
      case 'Market':
        return '按最新可成交价格执行';
      case 'Limit':
        return order.price !== undefined
          ? `只有在价格触及 ${formatMarketPrice(order.price, { symbol: order.symbol })} 时才会成交`
          : '限价单缺少价格';
      case 'Stop':
        return order.stop_price !== undefined
          ? `只有在价格触及止损价 ${formatMarketPrice(order.stop_price, { symbol: order.symbol })} 时才会触发`
          : '止损单缺少触发价';
      case 'StopLimit':
        return '先触发止损，再按限价撮合';
      default:
        return order.order_type;
    }
  };

  const getStatusBadgeClass = (status: Order['status']): string => {
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

  type OrderTimelineItem = {
    label: string;
    detail: string;
    timestamp?: string;
    tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
  };

  const formatTimelinePrice = (value: unknown, symbol: string): string | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return formatMarketPrice(value, { symbol });
  };

  const auditEntryToTimeline = (order: Order, entry: OrderAuditEntry): OrderTimelineItem => {
    const details = entry.details ?? {};
    const symbol = typeof details.symbol === 'string' ? details.symbol : order.symbol;
    const filledQuantity = typeof details.filled_quantity === 'number' ? details.filled_quantity : null;
    const remainingQuantity = typeof details.remaining_quantity === 'number' ? details.remaining_quantity : null;
    const fillPrice = formatTimelinePrice(details.fill_price, symbol);
    const avgPrice = formatTimelinePrice(details.average_fill_price, symbol);
    const previousStatus = typeof details.previous_status === 'string' ? details.previous_status : null;
    const status = typeof details.status === 'string' ? details.status : null;
    const reason = typeof details.reason === 'string' ? details.reason : null;

    switch (entry.action) {
      case 'order_created':
        return {
          label: '创建',
          detail: `${symbol} ${details.side ?? order.side} ${details.quantity ?? order.quantity} 股，${details.order_type ?? order.order_type} 订单已进入系统。`,
          timestamp: entry.created_at,
          tone: 'neutral',
        };
      case 'order_submitted':
        return {
          label: '提交',
          detail: `状态从 ${previousStatus ?? order.status} 变更为 ${status ?? 'Submitted'}，已进入执行层。`,
          timestamp: entry.created_at,
          tone: 'info',
        };
      case 'order_partially_filled':
        return {
          label: '部分成交',
          detail: `${filledQuantity ?? order.filled_quantity} 股成交，剩余 ${remainingQuantity ?? (order.quantity - order.filled_quantity)} 股，均价 ${avgPrice ?? 'N/A'}。`,
          timestamp: entry.created_at,
          tone: 'warning',
        };
      case 'order_filled':
        return {
          label: '成交',
          detail: `${filledQuantity ?? order.quantity} 股全部成交，成交价 ${fillPrice ?? 'N/A'}，均价 ${avgPrice ?? 'N/A'}。`,
          timestamp: entry.created_at,
          tone: 'success',
        };
      case 'order_cancelled':
        return {
          label: '取消',
          detail: `订单已取消，最终状态 ${status ?? order.status}。`,
          timestamp: entry.created_at,
          tone: 'warning',
        };
      case 'order_rejected':
        return {
          label: '拒绝',
          detail: reason ? `订单被拒绝: ${reason}` : '订单被拒绝。',
          timestamp: entry.created_at,
          tone: 'danger',
        };
      case 'risk_check_completed':
        return {
          label: '风控检查',
          detail: `${status ?? 'passed'}${reason ? `，${reason}` : ''}。`,
          timestamp: entry.created_at,
          tone: status === 'rejected' ? 'danger' : status === 'warning' ? 'warning' : 'info',
        };
      default:
        return {
          label: entry.action,
          detail: JSON.stringify(details),
          timestamp: entry.created_at,
          tone: 'info',
        };
    }
  };

  const buildOrderTimeline = (order: Order, entries: OrderAuditEntry[] = []): OrderTimelineItem[] => {
    const sortedEntries = [...entries].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    if (sortedEntries.length > 0) {
      const timeline = sortedEntries.map((entry) => auditEntryToTimeline(order, entry));
      if (selectedSimulation?.order_id === order.id) {
        timeline.push({
          label: '最近一次模拟',
          detail: selectedSimulation.detail,
          timestamp: order.updated_at,
          tone: selectedSimulation.action === 'filled' || selectedSimulation.action === 'partially_filled'
            ? 'success'
            : selectedSimulation.action === 'unsupported'
              ? 'danger'
              : 'info',
        });
      }
      return timeline;
    }

    const timeline: OrderTimelineItem[] = [
      {
        label: '创建',
        detail: '订单已写入系统并等待后续处理。',
        timestamp: order.created_at,
        tone: 'neutral',
      },
      {
        label: '提交',
        detail: order.status === 'Pending'
          ? '订单尚未提交到执行层。'
          : '订单已进入执行层。',
        timestamp: order.updated_at,
        tone: order.status === 'Rejected' ? 'danger' : 'info',
      },
    ];

    if (order.filled_quantity > 0) {
      timeline.push({
        label: order.status === 'PartiallyFilled' ? '部分成交' : '成交',
        detail: `${order.filled_quantity} / ${order.quantity} 已成交，均价 ${
          order.average_fill_price !== undefined
            ? formatMarketPrice(order.average_fill_price, { symbol: order.symbol })
            : 'N/A'
        }。`,
        timestamp: order.updated_at,
        tone: order.status === 'Filled' ? 'success' : 'warning',
      });
    }

    if (order.status === 'Cancelled') {
      timeline.push({
        label: '取消',
        detail: '订单已被手动取消或撤单。',
        timestamp: order.updated_at,
        tone: 'warning',
      });
    }

    if (order.status === 'Rejected') {
      timeline.push({
        label: '拒绝',
        detail: '订单未通过风控或执行层校验。',
        timestamp: order.updated_at,
        tone: 'danger',
      });
    }

    if (selectedSimulation?.order_id === order.id) {
      timeline.push({
        label: '最近一次模拟',
        detail: selectedSimulation.detail,
        timestamp: order.updated_at,
        tone: selectedSimulation.action === 'filled' || selectedSimulation.action === 'partially_filled'
          ? 'success'
          : selectedSimulation.action === 'unsupported'
            ? 'danger'
            : 'info',
      });
    }

    return timeline;
  };

  const getTimelineToneClass = (tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger'): string => {
    switch (tone) {
      case 'success':
        return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-50';
      case 'warning':
        return 'border-amber-400/30 bg-amber-400/10 text-amber-50';
      case 'danger':
        return 'border-rose-400/30 bg-rose-400/10 text-rose-50';
      case 'info':
        return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-50';
      case 'neutral':
      default:
        return 'border-slate-700 bg-white/5 text-slate-100';
    }
  };

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

      {orderFeedback && (
        <div className={`rounded-lg border p-4 ${
          orderFeedback.accepted
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          <div className="font-medium">
            {orderFeedback.accepted ? '订单已接受' : '订单被风控拒绝'}
          </div>
          {orderFeedback.risk_check?.message && (
            <div className="mt-1 text-sm">{orderFeedback.risk_check.message}</div>
          )}
          {orderFeedback.risk_check && (
            <div className="mt-3 space-y-2 text-sm">
              {orderFeedback.risk_check.checks.map((check) => (
                <div key={`${check.rule_code}-${check.check_type}`} className="rounded border border-current/10 bg-white/40 p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{check.check_type}</div>
                      <div className="text-xs opacity-80">{check.rule_code}</div>
                    </div>
                    <span className={check.passed ? 'text-green-700' : 'text-red-700'}>
                      {check.passed ? '通过' : '失败'} / {check.severity}
                    </span>
                  </div>
                  <div className="mt-2 text-sm">{check.message}</div>
                  {(check.actual_value || check.threshold_value) && (
                    <div className="mt-2 grid grid-cols-2 gap-3 text-xs opacity-80">
                      <div>实际值: {check.actual_value ?? 'N/A'}</div>
                      <div>阈值: {check.threshold_value ?? 'N/A'}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {simulationFeedback && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-900">
          <div className="font-medium">
            模拟撮合完成: 处理 {simulationFeedback.processed} 笔，成交 {simulationFeedback.filled} 笔，部分成交 {simulationFeedback.partially_filled} 笔，提交 {simulationFeedback.submitted} 笔，未变更 {simulationFeedback.untouched} 笔
          </div>
          {simulationFeedback.unsupported > 0 && (
            <div className="mt-1 text-sm">
              其中 {simulationFeedback.unsupported} 笔为当前暂不支持的订单类型。
            </div>
          )}
          {simulationFeedback.results.length > 0 && (
            <div className="mt-3 space-y-2 text-sm">
              {simulationFeedback.results.slice(0, 5).map((result) => (
                <div key={result.order_id} className="rounded border border-blue-100 bg-white/70 p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{result.symbol}</div>
                      <div className="text-xs opacity-70">
                        {result.status_before} {'->'} {result.status_after}
                      </div>
                    </div>
                    <div className="text-xs font-medium uppercase">{result.action}</div>
                  </div>
                  <div className="mt-2">{result.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-medium text-slate-900">策略执行状态概览</h3>
            <p className="mt-1 text-sm text-slate-500">
              按策略维度并排查看最近回测、最近真实成交，以及为未来信号确认台预留的信号摘要位置。
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {strategyStateCards.length} 个活跃策略
          </span>
        </div>
        <div className="grid gap-4 p-6 lg:grid-cols-2 xl:grid-cols-3">
          {strategyStateCards.map(({ strategy, state }) => (
            <div key={strategy.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-base font-semibold text-slate-900">
                    {strategy.display_name || strategy.name}
                  </h4>
                  <p className="mt-1 font-mono text-xs text-slate-500">{strategy.id}</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">
                  {state ? '已聚合' : '加载中'}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-sky-100 bg-white p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-sky-900">
                    <Activity className="h-4 w-4" />
                    最近一次回测
                  </div>
                  {state?.latest_backtest ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      <div>{state.latest_backtest.symbol ?? '-'} / {state.latest_backtest.timeframe ?? '-'}</div>
                      <div>
                        收益率 {(state.latest_backtest.total_return * 100).toFixed(2)}%，Sharpe{' '}
                        {state.latest_backtest.sharpe_ratio.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatCompactDateTime(state.latest_backtest.created_at)}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">暂无回测记录</p>
                  )}
                </div>

                <div className="rounded-xl border border-emerald-100 bg-white p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                    <Clock3 className="h-4 w-4" />
                    最近一次真实成交
                  </div>
                  {state?.latest_real_trade ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      <div>
                        {state.latest_real_trade.symbol} / {state.latest_real_trade.side} / {state.latest_real_trade.quantity} 股
                      </div>
                      <div>{formatMarketPrice(state.latest_real_trade.price, { symbol: state.latest_real_trade.symbol })}</div>
                      <div className="text-xs text-slate-500">
                        {formatCompactDateTime(state.latest_real_trade.executed_at)}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">暂无真实执行成交</p>
                  )}
                </div>

                <div className="rounded-xl border border-amber-100 bg-white p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                    <Radar className="h-4 w-4" />
                    最近信号摘要
                  </div>
                  {state ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      <div>{formatSignalStatus(state.recent_signal)}</div>
                      <div className="text-xs text-slate-500">
                        {state.recent_signal.symbol ?? state.latest_backtest?.symbol ?? '待接入标的上下文'}
                        {state.recent_signal.timeframe ? ` / ${state.recent_signal.timeframe}` : ''}
                      </div>
                      <div className="text-xs text-slate-500">{state.recent_signal.note}</div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">正在加载信号摘要</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          {strategyStateCards.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
              当前没有活跃策略，策略执行状态概览会在启用策略后显示。
            </div>
          )}
        </div>
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
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_380px]">
        <div className="bg-white rounded-lg shadow">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">订单列表</h3>
          <button
            type="button"
            onClick={() => simulateOrdersMutation.mutate()}
            disabled={simulateOrdersMutation.isPending}
            className="rounded-md border border-blue-200 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {simulateOrdersMutation.isPending ? '模拟中...' : '运行模拟撮合'}
          </button>
        </div>

        <div className="grid gap-3 border-b border-gray-200 bg-slate-50 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Open Orders</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{openOrdersCount}</div>
            <div className="mt-1 text-xs text-slate-500">待成交、已提交或部分成交</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Partials</div>
            <div className="mt-2 text-2xl font-semibold text-amber-700">{partiallyFilledCount}</div>
            <div className="mt-1 text-xs text-slate-500">需要盯住剩余数量</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Filled</div>
            <div className="mt-2 text-2xl font-semibold text-emerald-700">{filledCount}</div>
            <div className="mt-1 text-xs text-slate-500">已完全成交订单</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Terminal</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{terminalCount}</div>
            <div className="mt-1 text-xs text-slate-500">成交、取消、拒单</div>
          </div>
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
                    <tr
                      key={order.id}
                      onClick={() => setSelectedOrderId(order.id)}
                      className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                        selectedOrder?.id === order.id ? 'bg-blue-50/60' : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          <span>{order.symbol}</span>
                          {selectedOrder?.id === order.id && (
                            <ChevronRight className="h-4 w-4 text-blue-600" />
                          )}
                        </div>
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                        order.side === 'Buy' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {order.side === 'Buy' ? '买入' : '卖出'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {getOrderTypeText(order.order_type)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {order.filled_quantity}/{order.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {order.price !== undefined
                          ? formatMarketPrice(order.price, { symbol: order.symbol })
                          : 'Market'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(order.status)}`}>
                          {getStatusText(order.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {(order.status === 'Pending' || order.status === 'Submitted') && (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              handleCancelOrder(order.id);
                            }}
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

        <aside className="rounded-lg border border-slate-200 bg-slate-950 text-slate-100 shadow-xl shadow-slate-950/10">
          <div className="border-b border-slate-800 px-5 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Order Detail</p>
            <h3 className="mt-2 text-lg font-semibold">
              {selectedOrder ? selectedOrder.symbol : '选择一笔订单'}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {selectedOrder ? getLifecycleStep(selectedOrder) : '点击左侧订单查看生命周期、成交信息和最近一次模拟结果。'}
            </p>
          </div>

          {selectedOrder ? (
            <div className="space-y-5 px-5 py-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/5 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">状态</p>
                  <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusBadgeClass(selectedOrder.status)}`}>
                    {getStatusText(selectedOrder.status)}
                  </span>
                </div>
                <div className="rounded-xl bg-white/5 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">完成度</p>
                  <p className="mt-2 text-sm font-semibold">{filledRatio}%</p>
                  <div className="mt-2 h-2 rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-cyan-400"
                      style={{ width: `${filledRatio}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl bg-white/5 p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-400">订单类型</span>
                  <span className="text-sm font-medium">{getOrderTypeText(selectedOrder.order_type)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-400">方向</span>
                  <span className={`text-sm font-medium ${selectedOrder.side === 'Buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedOrder.side === 'Buy' ? '买入' : '卖出'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-400">数量</span>
                  <span className="text-sm font-medium">{selectedOrder.filled_quantity}/{selectedOrder.quantity}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-400">限价</span>
                  <span className="text-sm font-medium">
                    {selectedOrder.price !== undefined
                      ? formatMarketPrice(selectedOrder.price, { symbol: selectedOrder.symbol })
                      : 'Market'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-400">止损价</span>
                  <span className="text-sm font-medium">
                    {selectedOrder.stop_price !== undefined
                      ? formatMarketPrice(selectedOrder.stop_price, { symbol: selectedOrder.symbol })
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-400">均价</span>
                  <span className="text-sm font-medium">
                    {selectedOrder.average_fill_price !== undefined
                      ? formatMarketPrice(selectedOrder.average_fill_price, { symbol: selectedOrder.symbol })
                      : 'N/A'}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-white/5 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock3 className="h-4 w-4 text-cyan-300" />
                  生命周期
                </div>
                <div className="mt-3 space-y-3 text-sm">
                  {buildOrderTimeline(selectedOrder, selectedOrderAudit?.entries ?? []).map((item) => (
                    <div
                      key={`${item.label}-${item.timestamp ?? item.detail}`}
                      className={`rounded-xl border px-4 py-3 ${getTimelineToneClass(item.tone)}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="font-medium">{item.label}</div>
                        <div className="text-xs opacity-70">
                          {item.timestamp ? formatMarketTimestamp(item.timestamp) : 'N/A'}
                        </div>
                      </div>
                      <div className="mt-2 text-sm opacity-90">{item.detail}</div>
                    </div>
                  ))}
                  <div className="rounded-xl border border-slate-700 bg-white/5 px-4 py-3 text-slate-300">
                    <div className="font-medium text-slate-100">执行提示</div>
                    <div className="mt-2 text-sm">{getOrderTypeHint(selectedOrder)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-white/5 p-4">
                <div className="text-sm font-medium text-slate-100">高级参数</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-300">
                  <div>
                    <div className="text-slate-400">TIF</div>
                    <div>{selectedOrder.time_in_force ?? 'Day'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">盘前盘后</div>
                    <div>{selectedOrder.extended_hours ? '允许' : '关闭'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">策略</div>
                    <div>{selectedOrder.strategy_id ?? 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">订单 ID</div>
                    <div className="break-all text-xs">{selectedOrder.id}</div>
                  </div>
                </div>
              </div>

              {selectedSimulation && (
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                  <div className="text-sm font-medium text-cyan-100">最近一次模拟撮合结果</div>
                  <div className="mt-2 text-sm text-cyan-50/90">{selectedSimulation.detail}</div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-cyan-50/90">
                    <div>
                      <div className="text-cyan-200/70">市场价</div>
                      <div>
                        {selectedSimulation.market_price !== null && selectedSimulation.market_price !== undefined
                          ? formatMarketPrice(selectedSimulation.market_price, { symbol: selectedOrder.symbol })
                          : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-cyan-200/70">成交价</div>
                      <div>
                        {selectedSimulation.fill_price !== null && selectedSimulation.fill_price !== undefined
                          ? formatMarketPrice(selectedSimulation.fill_price, { symbol: selectedOrder.symbol })
                          : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-cyan-200/70">前状态</div>
                      <div>{selectedSimulation.status_before}</div>
                    </div>
                    <div>
                      <div className="text-cyan-200/70">后状态</div>
                      <div>{selectedSimulation.status_after}</div>
                    </div>
                  </div>
                </div>
              )}

              {(selectedOrder.status === 'Pending' || selectedOrder.status === 'Submitted') && (
                <button
                  type="button"
                  onClick={() => handleCancelOrder(selectedOrder.id)}
                  disabled={cancelOrderMutation.isPending}
                  className="w-full rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100 hover:bg-rose-500/20 disabled:opacity-50"
                >
                  取消当前订单
                </button>
              )}
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-slate-400">
              当前没有可展示的订单。
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
