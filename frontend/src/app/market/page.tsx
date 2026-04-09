'use client';

import { useState, useEffect, useRef } from 'react';
import { MarketDataWidget } from '@/components/market/MarketDataWidget';
import { marketDataApi, WebSocketManager } from '@/lib/api';
import { formatMarketNumber, formatMarketPrice, getMarketStatusLabel, inferCurrency } from '@/lib/market';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Search, Loader2, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import type { MarketData, MarketDataMeta, MarketQuoteResult } from '@/types';
import {
  filterStocksByChangePercentRange,
  filterSearchResultsByMarket,
  getChangePercentRangeError,
  sortStocksByBoardMode,
  type BoardMode,
  type ChangePercentRange,
  type MarketTab,
} from './market-page-helpers';

interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency?: string;
  exchange?: string;
}

interface SearchResult {
  symbol: string;
  instrument_name: string;
  exchange: string;
  country: string;
  instrument_type: string;
}

interface ChartPoint {
  timestamp: string;
  time: string;
  price: number;
  volume: number;
}

interface MarketListResponse {
  count?: number;
  data?: SearchResult[];
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeSearchSymbol = (result: SearchResult): string => {
  const rawSymbol = result.symbol.trim().toUpperCase();
  const exchange = result.exchange.trim().toUpperCase();
  const country = result.country.trim().toUpperCase();

  if (rawSymbol.endsWith('.HK')) {
    return rawSymbol;
  }

  const isHongKong =
    country.includes('HONG KONG') ||
    exchange.includes('HK') ||
    exchange.includes('HONG KONG');

  if (isHongKong && /^\d+$/.test(rawSymbol)) {
    const normalizedCode = rawSymbol.length >= 4 ? rawSymbol : rawSymbol.padStart(4, '0');
    return `${normalizedCode}.HK`;
  }

  return rawSymbol;
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

const parseOptionalNumber = (value: string): number | null => {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

export default function MarketPage() {
  const wsManagerRef = useRef<WebSocketManager | null>(null);
  const selectedSymbolRef = useRef('AAPL');
  const [selectedTimeframe, setSelectedTimeframe] = useState('1D');
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const [selectedMarket, setSelectedMarket] = useState<MarketTab>('US');
  const [selectedBoardMode, setSelectedBoardMode] = useState<BoardMode>('all');
  const [marketStocks, setMarketStocks] = useState<StockData[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<MarketQuoteResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartRefreshing, setChartRefreshing] = useState(false);
  const [lastChartUpdatedAt, setLastChartUpdatedAt] = useState<string | null>(null);
  const [chartMeta, setChartMeta] = useState<MarketDataMeta | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [minChangePercentInput, setMinChangePercentInput] = useState('');
  const [maxChangePercentInput, setMaxChangePercentInput] = useState('');
  
  // 搜索相关状态
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchMarketStocks = async () => {
      setLoading(true);

      try {
        const payload = (await marketDataApi.getMarketList(selectedMarket)) as MarketListResponse;
        const symbols = Array.isArray(payload.data)
          ? payload.data
              .map((item) => normalizeSearchSymbol(item))
              .filter((value, index, all) => value && all.indexOf(value) === index)
          : [];

        if (symbols.length === 0) {
          if (!cancelled) {
            setMarketStocks([]);
          }
          return;
        }

        const quotes = await marketDataApi.getMultipleSymbols(symbols);
        const detailsBySymbol = new Map(
          (payload.data ?? []).map((item) => [normalizeSearchSymbol(item), item] as const)
        );

        const stocks = quotes
          .filter((item) => item.success)
          .map((item) => {
            const normalizedSymbol = item.data?.symbol ?? item.meta.normalized_symbol;
            const detail = detailsBySymbol.get(normalizedSymbol);

            return {
              symbol: normalizedSymbol,
              name: detail?.instrument_name || normalizedSymbol,
              price: toFiniteNumber(item.data?.price),
              change: toFiniteNumber(item.data?.change),
              changePercent: toFiniteNumber(item.data?.change_percent),
              currency: typeof item.data?.currency === 'string' ? item.data.currency : undefined,
              exchange:
                typeof item.data?.exchange === 'string'
                  ? item.data.exchange
                  : detail?.exchange,
            };
          });

        if (!cancelled) {
          setMarketStocks(stocks);
        }
      } catch (error) {
        console.error("Failed to fetch market data", error);
        if (!cancelled) {
          setMarketStocks([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchMarketStocks();
    // 每30秒刷新一次数据
    const interval = setInterval(fetchMarketStocks, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshNonce, selectedMarket]);

  useEffect(() => {
    if (marketStocks.length === 0) {
      return;
    }

    const currentSymbolExists = marketStocks.some((stock) => stock.symbol === selectedSymbol);
    if (!currentSymbolExists) {
      setSelectedSymbol(marketStocks[0]?.symbol ?? 'AAPL');
    }
  }, [marketStocks, selectedSymbol]);

  // 处理搜索
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.trim().length > 1) {
        setIsSearching(true);
        setShowSearchResults(true);
        try {
          const response = await marketDataApi.searchSymbols(searchQuery);
          const rawResults = Array.isArray(response?.data)
            ? response.data
            : Array.isArray(response)
              ? response
              : [];

          if (rawResults.length > 0) {
             setSearchResults(filterSearchResultsByMarket(rawResults, selectedMarket));
          } else {
             setSearchResults([]);
          }
        } catch (error) {
          console.error("Search failed", error);
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
        setShowSearchResults(false);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, selectedMarket]);

  // 选择搜索结果
  const handleSelectSymbol = (result: SearchResult) => {
    const normalizedSymbol = normalizeSearchSymbol(result);
    setSelectedSymbol(normalizedSymbol);
    setSearchQuery('');
    setShowSearchResults(false);
  };

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  useEffect(() => {
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
          payload.symbol.toUpperCase() !== selectedSymbolRef.current.toUpperCase()
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
      () => {
        setWsConnected(false);
      },
      (connected) => setWsConnected(connected)
    );

    return () => {
      setWsConnected(false);
      wsManager.disconnect();
      wsManagerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!wsManagerRef.current) {
      return;
    }

    wsManagerRef.current.send({
      type: 'Subscribe',
      data: {
        channels: [`market_data:${selectedSymbol}`],
      },
    });
  }, [selectedSymbol]);

  useEffect(() => {
    let cancelled = false;

    const fetchSelectedQuote = async () => {
      try {
        const quote = await marketDataApi.getRealTimeData(selectedSymbol);
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
  }, [selectedSymbol]);

  // 获取图表数据
  useEffect(() => {
    let cancelled = false;

    const generateChartData = async (backgroundRefresh = false) => {
      if (backgroundRefresh) {
        setChartRefreshing(true);
      } else {
        setChartLoading(true);
      }

      try {
        const { interval, startDate, endDate } = getHistoryParams(selectedTimeframe);
        const history = await marketDataApi.getHistoricalData(selectedSymbol, startDate, endDate, interval);
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
  }, [selectedSymbol, selectedTimeframe, selectedQuote]);

  useEffect(() => {
    setChartData((currentData) => applyQuoteToChartData(currentData, selectedQuote?.data ?? null));
  }, [selectedQuote]);

  const selectedStock = marketStocks.find(s => s.symbol === selectedSymbol);
  const selectedMarketData = selectedQuote?.data
    ? {
        symbol: selectedQuote.data.symbol,
        price: toFiniteNumber(selectedQuote.data.price),
        change: toFiniteNumber(selectedQuote.data.change),
        changePercent: toFiniteNumber(selectedQuote.data.change_percent),
        exchange: selectedQuote.data.exchange,
        currency: selectedQuote.data.currency,
      }
    : selectedStock
      ? {
          symbol: selectedStock.symbol,
          price: selectedStock.price,
          change: selectedStock.change,
          changePercent: selectedStock.changePercent,
          exchange: selectedStock.exchange,
          currency: selectedStock.currency,
        }
      : null;
  const selectedCurrency = inferCurrency(
    selectedMarketData?.symbol ?? selectedSymbol,
    selectedMarketData?.exchange,
    selectedMarketData?.currency
  );
  const isPositive = selectedMarketData ? selectedMarketData.change >= 0 : true;
  const quoteMeta = selectedQuote?.meta;
  const changePercentRange: ChangePercentRange = {
    min: parseOptionalNumber(minChangePercentInput),
    max: parseOptionalNumber(maxChangePercentInput),
  };
  const changePercentRangeError = getChangePercentRangeError(changePercentRange);
  const displayedStocks = filterStocksByChangePercentRange(
    sortStocksByBoardMode(marketStocks, selectedBoardMode),
    changePercentRange
  );
  const marketLabel = selectedMarket === 'US' ? '美股市场' : '港股市场';
  const boardOptions: Array<{ value: BoardMode; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'gainers', label: '涨幅榜' },
    { value: 'losers', label: '跌幅榜' },
  ];
  const marketTabs: Array<{ value: MarketTab; label: string }> = [
    { value: 'US', label: '美股' },
    { value: 'HK', label: '港股' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">市场概览</h1>
          <p className="text-muted-foreground mt-1">按市场切换查看实时行情、涨幅榜和跌幅榜</p>
        </div>
        
        {/* 搜索框 */}
        <div className="relative w-full md:w-80">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2.5 border border-input rounded-lg leading-5 bg-background/50 backdrop-blur-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent sm:text-sm shadow-sm transition-all"
            placeholder="搜索代码 (例如: AAPL)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {isSearching && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
            </div>
          )}
          
          {/* 搜索结果下拉框 */}
          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute z-50 mt-2 w-full bg-popover text-popover-foreground shadow-xl rounded-lg py-1 ring-1 ring-black ring-opacity-5 overflow-hidden max-h-80 overflow-y-auto">
              {searchResults.map((result, index) => (
                <div
                  key={`${result.symbol}-${index}`}
                  className="cursor-pointer select-none relative py-3 pl-4 pr-4 hover:bg-accent hover:text-accent-foreground transition-colors border-b border-border/50 last:border-0"
                  onMouseDown={() => handleSelectSymbol(result)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm">{result.symbol}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">{result.instrument_type}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate max-w-[180px]">{result.instrument_name}</span>
                    <span>{result.exchange}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showSearchResults && !isSearching && searchResults.length === 0 && searchQuery.trim().length > 1 && (
            <div className="absolute z-50 mt-2 w-full bg-popover text-popover-foreground shadow-xl rounded-lg px-4 py-3 ring-1 ring-black ring-opacity-5 text-sm text-muted-foreground">
              当前市场没有匹配标的
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧图表区域 */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card text-card-foreground p-6 rounded-xl shadow-sm border border-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <div className="flex items-center gap-4">
                <div>
                  <h3 className="text-2xl font-bold">{selectedSymbol}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {selectedMarketData && (
                      <>
                        <span className="text-xl font-mono">
                          {formatMarketPrice(selectedMarketData.price, {
                            symbol: selectedMarketData.symbol,
                            exchange: selectedMarketData.exchange,
                            currency: selectedMarketData.currency,
                          })}
                        </span>
                        <span className={`flex items-center text-sm font-medium px-2 py-0.5 rounded ${isPositive ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                          {selectedMarketData.change >= 0 ? '+' : ''}{formatMarketNumber(selectedMarketData.change)} ({formatMarketNumber(selectedMarketData.changePercent)}%)
                        </span>
                      </>
                    )}
                    {quoteMeta && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        quoteMeta.status === 'degraded'
                          ? 'bg-yellow-100 text-yellow-700'
                          : quoteMeta.status === 'error'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-secondary text-secondary-foreground'
                      }`}>
                        {getMarketStatusLabel(quoteMeta)} / {quoteMeta.source}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">图表刷新</div>
                  <div className="text-xs font-medium flex items-center justify-end gap-1">
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
                  <div className={`text-[11px] ${wsConnected ? 'text-success' : 'text-muted-foreground'}`}>
                    {wsConnected ? 'WebSocket 已连接' : 'WebSocket 断开，使用轮询'}
                  </div>
                </div>

                <div className="flex bg-secondary/50 p-1 rounded-lg">
                  {['1D', '1W', '1M', '3M', '1Y'].map((timeframe) => (
                    <button
                      key={timeframe}
                      onClick={() => setSelectedTimeframe(timeframe)}
                      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                        selectedTimeframe === timeframe
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                      }`}
                    >
                      {timeframe}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="h-[400px] w-full">
              {chartLoading ? (
                <div className="h-full w-full flex items-center justify-center">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                </div>
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isPositive ? "hsl(var(--success))" : "hsl(var(--destructive))"} stopOpacity={0.2}/>
                        <stop offset="95%" stopColor={isPositive ? "hsl(var(--success))" : "hsl(var(--destructive))"} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
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
                      tickFormatter={(value) => `$${toFiniteNumber(value).toFixed(0)}`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--popover))", 
                        borderColor: "hsl(var(--border))",
                        borderRadius: "var(--radius)",
                        color: "hsl(var(--popover-foreground))"
                      }}
                      formatter={(value: number | string) => [
                        formatMarketPrice(toFiniteNumber(value), {
                          symbol: selectedSymbol,
                          currency: selectedCurrency,
                        }),
                        'Price',
                      ]}
                      labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="price" 
                      stroke={isPositive ? "hsl(var(--success))" : "hsl(var(--destructive))"} 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorPrice)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground bg-secondary/20 rounded-lg">
                  <TrendingUp className="h-12 w-12 mb-2 opacity-20" />
                  <p>暂无此时间段的图表数据</p>
                  {chartMeta?.message && (
                    <p className="mt-2 text-xs">{chartMeta.message}</p>
                  )}
                </div>
              )}
            </div>
            {chartMeta?.status === 'degraded' && (
              <div className="mt-4 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                图表数据使用降级源 `{chartMeta.source}`。{chartMeta.message ?? '上游返回不完整，已回退到备用来源。'}
              </div>
            )}
          </div>
          
          <MarketDataWidget symbol={selectedSymbol} />
        </div>

        {/* 右侧列表区域 */}
        <div className="space-y-6">
          <div className="bg-card text-card-foreground p-6 rounded-xl shadow-sm border border-border">
            <div className="flex items-center justify-between gap-3 mb-6">
              <div>
                <h3 className="text-lg font-bold">{marketLabel}</h3>
                <p className="text-xs text-muted-foreground mt-1">按当前市场查看全部股票、涨幅榜和跌幅榜</p>
              </div>
              <button 
                onClick={() => setRefreshNonce((value) => value + 1)}
                disabled={loading}
                className="p-2 hover:bg-secondary rounded-full transition-colors text-muted-foreground hover:text-foreground"
                aria-label="刷新市场列表"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div
              role="tablist"
              aria-label="市场切换"
              className="flex items-center gap-2 rounded-lg bg-secondary/40 p-1 mb-4"
            >
              {marketTabs.map((tab) => (
                <button
                  key={tab.value}
                  role="tab"
                  type="button"
                  aria-selected={selectedMarket === tab.value}
                  onClick={() => setSelectedMarket(tab.value)}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    selectedMarket === tab.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-6">
              {boardOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedBoardMode(option.value)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedBoardMode === option.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/70 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              <label className="text-xs text-muted-foreground">
                最小涨跌幅
                <input
                  aria-label="最小涨跌幅"
                  type="number"
                  value={minChangePercentInput}
                  onChange={(e) => setMinChangePercentInput(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="例如 5"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                最大涨跌幅
                <input
                  aria-label="最大涨跌幅"
                  type="number"
                  value={maxChangePercentInput}
                  onChange={(e) => setMaxChangePercentInput(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="例如 -5"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => {
                setMinChangePercentInput('');
                setMaxChangePercentInput('');
              }}
              className="mb-4 text-xs text-muted-foreground hover:text-foreground"
            >
              重置筛选
            </button>

            {changePercentRangeError && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {changePercentRangeError}
              </div>
            )}
            
            {loading ? (
              <div className="space-y-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="animate-pulse flex items-center justify-between p-3">
                    <div className="space-y-2">
                      <div className="h-4 w-12 bg-secondary rounded"></div>
                      <div className="h-3 w-24 bg-secondary rounded"></div>
                    </div>
                    <div className="space-y-2 flex flex-col items-end">
                      <div className="h-4 w-16 bg-secondary rounded"></div>
                      <div className="h-3 w-12 bg-secondary rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : displayedStocks.length > 0 ? (
              <div className="space-y-2">
                {displayedStocks.map((stock) => (
                  <button
                    type="button"
                    key={stock.symbol} 
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border border-transparent ${
                      selectedSymbol === stock.symbol 
                        ? 'bg-secondary border-border shadow-sm' 
                        : 'hover:bg-secondary/50'
                    }`}
                    onClick={() => setSelectedSymbol(stock.symbol)}
                    aria-label={`选择股票 ${stock.symbol}`}
                  >
                    <div>
                      <div className="font-bold">{stock.symbol}</div>
                      <div className="text-xs text-muted-foreground">{stock.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-medium">
                        {formatMarketPrice(stock.price, {
                          symbol: stock.symbol,
                          exchange: stock.exchange,
                          currency: stock.currency,
                        })}
                      </div>
                      <div className={`text-xs font-medium flex items-center justify-end ${stock.change >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {stock.change >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {marketStocks.length === 0 ? '当前市场暂无可展示股票' : '当前筛选下暂无股票'}
              </div>
            )}
          </div>
          
          {/* 这里可以放其他小组件，如市场情绪、新闻等 */}
          <div className="bg-gradient-to-br from-primary/10 to-transparent p-6 rounded-xl border border-primary/20">
            <h3 className="text-lg font-bold mb-2 text-primary">小贴士</h3>
            <p className="text-sm text-muted-foreground">
              使用搜索栏查找 Twelve Data 支持的任何股票、ETF 或加密货币对。
              尝试搜索 &quot;BTC/USD&quot; 或 &quot;EUR/USD&quot;。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
