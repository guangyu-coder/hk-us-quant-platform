'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { marketDataApi, WebSocketManager } from '@/lib/api';
import {
  formatMarketNumber,
  formatMarketPrice,
  getMarketStatusLabel,
  inferCurrency,
} from '@/lib/market';
import type { MarketData, MarketDataMeta, MarketQuoteResult } from '@/types';
import { MarketEmptyState } from '../_components/MarketEmptyState';
import { MarketModuleNav } from '../_components/MarketModuleNav';
import { normalizeMarketSymbol } from '../market-page-helpers';

interface ChartPoint {
  timestamp: string;
  time: string;
  price: number;
  volume: number;
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const formatChartLabel = (timestamp: string): string => {
  if (!timestamp) {
    return '';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const getHistoryParams = (selectedTimeframe: string) => {
  let interval = '1d';
  let startDate = '';
  const endDate = '';

  const now = new Date();
  const start = new Date();

  switch (selectedTimeframe) {
    case '1D':
      interval = '15m';
      start.setDate(now.getDate() - 1);
      startDate = start.toISOString().split('T')[0];
      break;
    case '1W':
      interval = '1h';
      start.setDate(now.getDate() - 7);
      startDate = start.toISOString().split('T')[0];
      break;
    case '1M':
      interval = '1d';
      start.setMonth(now.getMonth() - 1);
      startDate = start.toISOString().split('T')[0];
      break;
    case '3M':
      interval = '1d';
      start.setMonth(now.getMonth() - 3);
      startDate = start.toISOString().split('T')[0];
      break;
    case '1Y':
      interval = '1wk';
      start.setFullYear(now.getFullYear() - 1);
      startDate = start.toISOString().split('T')[0];
      break;
    default:
      interval = '1d';
  }

  return { interval, startDate, endDate };
};

const getChartRefreshInterval = (selectedTimeframe: string): number => {
  switch (selectedTimeframe) {
    case '1D':
      return 15000;
    case '1W':
      return 30000;
    default:
      return 60000;
  }
};

const applyQuoteToChartData = (
  existingData: ChartPoint[],
  quote: Partial<MarketData> | null
): ChartPoint[] => {
  if (!quote || existingData.length === 0 || !Number.isFinite(quote.price)) {
    return existingData;
  }

  const timestamp = quote.timestamp || new Date().toISOString();
  const nextPoint: ChartPoint = {
    timestamp,
    time: formatChartLabel(timestamp),
    price: quote.price ?? NaN,
    volume: toFiniteNumber(quote.volume),
  };

  const updatedData = [...existingData];
  const lastIndex = updatedData.length - 1;
  const lastPoint = updatedData[lastIndex];

  if (!lastPoint) {
    return [nextPoint];
  }

  const nextTime = new Date(timestamp).getTime();
  const lastTime = new Date(lastPoint.timestamp).getTime();

  if (Number.isFinite(nextTime) && Number.isFinite(lastTime) && nextTime > lastTime) {
    updatedData[lastIndex] = {
      ...lastPoint,
      price: nextPoint.price,
      volume: nextPoint.volume,
    };
    return updatedData;
  }

  updatedData[lastIndex] = {
    ...lastPoint,
    price: nextPoint.price,
    volume: nextPoint.volume,
  };

  return updatedData;
};

export default function MarketChartPage() {
  const searchParams = useSearchParams();
  const symbol = normalizeMarketSymbol(searchParams.get('symbol'));
  const wsManagerRef = useRef<WebSocketManager | null>(null);
  const symbolRef = useRef(symbol);
  const [selectedTimeframe, setSelectedTimeframe] = useState('1D');
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<MarketQuoteResult | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartRefreshing, setChartRefreshing] = useState(false);
  const [lastChartUpdatedAt, setLastChartUpdatedAt] = useState<string | null>(null);
  const [chartMeta, setChartMeta] = useState<MarketDataMeta | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);

  useEffect(() => {
    if (!symbol) {
      setSelectedQuote(null);
      setChartData([]);
      setChartMeta(null);
      return;
    }

    let cancelled = false;

    const fetchSelectedQuote = async () => {
      try {
        const quote = await marketDataApi.getRealTimeData(symbol);
        if (!cancelled) {
          setSelectedQuote(quote);
        }
      } catch (error) {
        console.error('Failed to fetch selected symbol quote', error);
      }
    };

    fetchSelectedQuote();
    const interval = setInterval(fetchSelectedQuote, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  useEffect(() => {
    if (!symbol) {
      return;
    }

    const wsManager = new WebSocketManager();
    wsManagerRef.current = wsManager;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    wsManager.connect(
      wsUrl,
      (message) => {
        if (message?.type !== 'MarketData' || !message.data) {
          return;
        }

        const payload = message.data;
        if (
          typeof payload.symbol !== 'string' ||
          payload.symbol.toUpperCase() !== symbolRef.current.toUpperCase()
        ) {
          return;
        }

        setSelectedQuote({
          success: true,
          data: {
            symbol: payload.symbol,
            timestamp: payload.timestamp ?? new Date().toISOString(),
            price: toFiniteNumber(payload.price),
            volume: toFiniteNumber(payload.volume),
            exchange: typeof payload.exchange === 'string' ? payload.exchange : undefined,
            currency: typeof payload.currency === 'string' ? payload.currency : undefined,
            change: toFiniteNumber(payload.change),
            change_percent: toFiniteNumber(payload.change_percent),
          },
          meta: {
            status: 'live',
            source: 'websocket',
            fallback_used: false,
            is_stale: false,
            degraded: false,
            requested_symbol: payload.symbol,
            normalized_symbol: payload.symbol,
          },
          error: null,
        });
      },
      () => setWsConnected(false),
      (connected) => setWsConnected(connected)
    );

    return () => {
      setWsConnected(false);
      wsManager.disconnect();
      wsManagerRef.current = null;
    };
  }, [symbol]);

  useEffect(() => {
    if (!symbol || !wsManagerRef.current) {
      return;
    }

    wsManagerRef.current.send({
      type: 'Subscribe',
      data: {
        channels: [`market_data:${symbol}`],
      },
    });
  }, [symbol]);

  useEffect(() => {
    if (!symbol) {
      return;
    }

    let cancelled = false;

    const generateChartData = async (backgroundRefresh = false) => {
      if (backgroundRefresh) {
        setChartRefreshing(true);
      } else {
        setChartLoading(true);
      }

      try {
        const { interval, startDate, endDate } = getHistoryParams(selectedTimeframe);
        const history = await marketDataApi.getHistoricalData(symbol, startDate, endDate, interval);

        if (!cancelled) {
          setChartMeta(history.meta);
        }

        if (!history.success || !Array.isArray(history.data) || history.data.length === 0) {
          if (!cancelled) {
            setChartData([]);
          }
          return;
        }

        const formattedData = history.data
          .map((item) => ({
            timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
            time: typeof item.timestamp === 'string' ? formatChartLabel(item.timestamp) : '',
            price: toFiniteNumber(item.price ?? item.close, NaN),
            volume: toFiniteNumber(item.volume),
          }))
          .filter((item) => item.timestamp && Number.isFinite(item.price));

        formattedData.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const mergedData = applyQuoteToChartData(formattedData, selectedQuote?.data ?? null);

        if (!cancelled) {
          setChartData(mergedData);
          setLastChartUpdatedAt(new Date().toISOString());
        }
      } catch (error) {
        console.error('Failed to fetch historical data', error);
        if (!cancelled) {
          setChartData([]);
        }
      } finally {
        if (!cancelled) {
          if (backgroundRefresh) {
            setChartRefreshing(false);
          } else {
            setChartLoading(false);
          }
        }
      }
    };

    generateChartData();
    const interval = setInterval(
      () => generateChartData(true),
      getChartRefreshInterval(selectedTimeframe)
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol, selectedTimeframe, selectedQuote]);

  useEffect(() => {
    setChartData((currentData) => applyQuoteToChartData(currentData, selectedQuote?.data ?? null));
  }, [selectedQuote]);

  if (!symbol) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-6 p-6">
        <MarketModuleNav current="chart" />
        <MarketEmptyState
          title="还没有选择股票"
          description="股票曲线页现在是独立页面。先从榜单里挑一只股票，或者直接用 `/market/chart?symbol=AAPL` 这样的地址进入。"
        />
      </div>
    );
  }

  const selectedMarketData = selectedQuote?.data
    ? {
        symbol: selectedQuote.data.symbol,
        price: toFiniteNumber(selectedQuote.data.price),
        change: toFiniteNumber(selectedQuote.data.change),
        changePercent: toFiniteNumber(selectedQuote.data.change_percent),
        exchange: selectedQuote.data.exchange,
        currency: selectedQuote.data.currency,
      }
    : null;
  const selectedCurrency = inferCurrency(
    selectedMarketData?.symbol ?? symbol,
    selectedMarketData?.exchange,
    selectedMarketData?.currency
  );
  const isPositive = selectedMarketData ? selectedMarketData.change >= 0 : true;
  const quoteMeta = selectedQuote?.meta;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <MarketModuleNav current="chart" symbol={symbol} />

      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Stock Chart
              </p>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">{symbol}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  独立的股票曲线页，专注看单只股票的最新报价、图表刷新状态和时间维度走势。
                </p>
              </div>
              {selectedMarketData ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-2xl font-mono font-semibold">
                    {formatMarketPrice(selectedMarketData.price, {
                      symbol: selectedMarketData.symbol,
                      exchange: selectedMarketData.exchange,
                      currency: selectedMarketData.currency,
                    })}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                      isPositive ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                    }`}
                  >
                    {isPositive ? (
                      <TrendingUp className="mr-1 h-4 w-4" />
                    ) : (
                      <TrendingDown className="mr-1 h-4 w-4" />
                    )}
                    {selectedMarketData.change >= 0 ? '+' : ''}
                    {formatMarketNumber(selectedMarketData.change)} ({formatMarketNumber(selectedMarketData.changePercent)}%)
                  </span>
                  {quoteMeta ? (
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                      {getMarketStatusLabel(quoteMeta)} / {quoteMeta.source}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl border border-border bg-secondary/20 px-3 py-2 text-right">
                <div className="text-xs text-muted-foreground">图表刷新</div>
                <div className="mt-1 flex items-center justify-end gap-1 text-xs font-medium">
                  <RefreshCw className={`h-3 w-3 ${chartRefreshing ? 'animate-spin' : ''}`} />
                  {lastChartUpdatedAt
                    ? new Date(lastChartUpdatedAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                      })
                    : '--:--:--'}
                </div>
                <div className={`mt-1 text-[11px] ${wsConnected ? 'text-success' : 'text-muted-foreground'}`}>
                  {wsConnected ? 'WebSocket 已连接' : 'WebSocket 断开，使用轮询'}
                </div>
              </div>

              <div className="flex rounded-xl bg-secondary/40 p-1">
                {['1D', '1W', '1M', '3M', '1Y'].map((timeframe) => (
                  <button
                    key={timeframe}
                    type="button"
                    onClick={() => setSelectedTimeframe(timeframe)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      selectedTimeframe === timeframe
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {timeframe}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-6">
          <div className="h-[460px] w-full">
            {chartLoading ? (
              <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.35} />
                  <XAxis
                    dataKey="time"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={30}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) =>
                      formatMarketPrice(toFiniteNumber(value), {
                        symbol,
                        currency: selectedCurrency,
                      })
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      borderColor: 'hsl(var(--border))',
                      borderRadius: 'var(--radius)',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    formatter={(value: number | string) => [
                      formatMarketPrice(toFiniteNumber(value), {
                        symbol,
                        currency: selectedCurrency,
                      }),
                      'Price',
                    ]}
                    labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke={isPositive ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
                    strokeWidth={2}
                    fill={isPositive ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
                    fillOpacity={0.12}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl bg-secondary/20 text-muted-foreground">
                <TrendingUp className="mb-2 h-12 w-12 opacity-20" />
                <p>暂无此时间段的图表数据</p>
                {chartMeta?.message ? <p className="mt-2 text-xs">{chartMeta.message}</p> : null}
              </div>
            )}
          </div>

          {chartMeta?.status === 'degraded' ? (
            <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
              图表数据使用降级源 `{chartMeta.source}`。{chartMeta.message ?? '上游返回不完整，已回退到备用来源。'}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
