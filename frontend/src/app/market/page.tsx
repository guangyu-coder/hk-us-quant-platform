'use client';

import { useState, useEffect } from 'react';
import { MarketDataWidget } from '@/components/market/MarketDataWidget';
import { marketDataApi } from '@/lib/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Search, Loader2, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

// 默认热门股票列表
const defaultPopularStocks = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', '0700.HK', '0941.HK', 'AMZN'];

interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

interface SearchResult {
  symbol: string;
  instrument_name: string;
  exchange: string;
  country: string;
  instrument_type: string;
}

export default function MarketPage() {
  const [selectedTimeframe, setSelectedTimeframe] = useState('1D');
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const [stockData, setStockData] = useState<StockData[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  
  // 搜索相关状态
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // 获取热门股票数据
  const fetchStockData = async () => {
    // 只有第一次加载时设置 loading
    if (stockData.length === 0) setLoading(true);
    
    const stocks: StockData[] = [];
    
    // 使用 batch API 获取数据
    try {
      const data = await marketDataApi.getMultipleSymbols(defaultPopularStocks);
      
      // 处理返回数据
      if (Array.isArray(data)) {
        data.forEach((item: any) => {
           if (item.success !== false) {
             const stockNames: Record<string, string> = {
               'AAPL': 'Apple Inc.',
               'GOOGL': 'Alphabet Inc.',
               'MSFT': 'Microsoft Corp.',
               'TSLA': 'Tesla Inc.',
               '0700.HK': 'Tencent Holdings',
               '0941.HK': 'China Mobile',
               'AMZN': 'Amazon.com',
             };

             stocks.push({
               symbol: item.symbol,
               name: stockNames[item.symbol] || item.symbol,
               price: item.price,
               change: item.change,
               changePercent: item.change_percent,
             });
           }
        });
      }
    } catch (error) {
      console.error("Failed to fetch market data", error);
    }
    
    setStockData(stocks);
    setLoading(false);
  };

  useEffect(() => {
    fetchStockData();
    // 每30秒刷新一次数据
    const interval = setInterval(fetchStockData, 30000);
    return () => clearInterval(interval);
  }, []);

  // 处理搜索
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.trim().length > 1) {
        setIsSearching(true);
        setShowSearchResults(true);
        try {
          const response = await marketDataApi.searchSymbols(searchQuery);
          if (response && response.data) {
             setSearchResults(response.data);
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
  }, [searchQuery]);

  // 选择搜索结果
  const handleSelectSymbol = (symbol: string) => {
    console.log('Selected symbol:', symbol);
    setSelectedSymbol(symbol);
    setSearchQuery('');
    setShowSearchResults(false);
  };

  // 获取图表数据
  useEffect(() => {
    const generateChartData = async () => {
      setChartLoading(true);
      
      // 尝试从 API 获取当前价格，如果 stockData 中没有，则单独获取
      let currentPrice = stockData.find(s => s.symbol === selectedSymbol)?.price;
      
      if (!currentPrice) {
         try {
           const data = await marketDataApi.getRealTimeData(selectedSymbol);
           if (data && typeof data.price === 'number') {
             currentPrice = data.price;
           }
         } catch (e) {
           console.error("Failed to fetch price for chart", e);
         }
      }
      
      if (!currentPrice) {
        setChartData([]);
        setChartLoading(false);
        return;
      }
      
      try {
        // 根据 selectedTimeframe 计算 interval 和日期范围
        let interval = '1day';
        let startDate = '';
        let endDate = ''; // 空字符串表示到现在
        
        const now = new Date();
        const start = new Date();
        
        switch(selectedTimeframe) {
          case '1D':
            interval = '15min'; // 1天用15分钟线
            break;
          case '1W':
            interval = '1h';
            start.setDate(now.getDate() - 7);
            startDate = start.toISOString().split('T')[0];
            break;
          case '1M':
            interval = '1day';
            start.setMonth(now.getMonth() - 1);
            startDate = start.toISOString().split('T')[0];
            break;
          case '3M':
            interval = '1day';
            start.setMonth(now.getMonth() - 3);
            startDate = start.toISOString().split('T')[0];
            break;
          case '1Y':
            interval = '1week';
            start.setFullYear(now.getFullYear() - 1);
            startDate = start.toISOString().split('T')[0];
            break;
          default:
            interval = '1day';
        }

        // 尝试调用历史数据接口
        const history = await marketDataApi.getHistoricalData(selectedSymbol, startDate, endDate, interval);
        if (Array.isArray(history) && history.length > 0) {
           // 确保数据格式正确适配图表
           const formattedData = history.map((item: any) => ({
             time: item.timestamp.length > 10 ? item.timestamp.replace('T', ' ').substring(5, 16) : item.timestamp, // 简化时间显示
             price: item.price || item.close,
             volume: item.volume
           }));
           // 按时间升序排序
           formattedData.sort((a, b) => new Date(history.find((h:any) => (h.price||h.close) === a.price)?.timestamp || 0).getTime() - new Date(history.find((h:any) => (h.price||h.close) === b.price)?.timestamp || 0).getTime());
           
           setChartData(formattedData);
        } else {
           setChartData([]);
        }
      } catch (e) {
        console.error("Failed to fetch historical data", e);
        setChartData([]);
      } finally {
        setChartLoading(false);
      }
    };

    generateChartData();
  }, [selectedSymbol, stockData, selectedTimeframe]);

  const selectedStock = stockData.find(s => s.symbol === selectedSymbol);
  const isPositive = selectedStock ? selectedStock.change >= 0 : true;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">市场概览</h1>
          <p className="text-muted-foreground mt-1">实时市场数据与分析</p>
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
                  onMouseDown={() => handleSelectSymbol(result.symbol)}
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
                    {selectedStock && (
                      <>
                        <span className="text-xl font-mono">${selectedStock.price.toFixed(2)}</span>
                        <span className={`flex items-center text-sm font-medium px-2 py-0.5 rounded ${isPositive ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                          {selectedStock.change >= 0 ? '+' : ''}{selectedStock.change.toFixed(2)} ({selectedStock.changePercent.toFixed(2)}%)
                        </span>
                      </>
                    )}
                  </div>
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
                      tickFormatter={(value) => `$${value.toFixed(0)}`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--popover))", 
                        borderColor: "hsl(var(--border))",
                        borderRadius: "var(--radius)",
                        color: "hsl(var(--popover-foreground))"
                      }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
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
                </div>
              )}
            </div>
          </div>
          
          <MarketDataWidget symbol={selectedSymbol} />
        </div>

        {/* 右侧列表区域 */}
        <div className="space-y-6">
          <div className="bg-card text-card-foreground p-6 rounded-xl shadow-sm border border-border">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold">热门资产</h3>
              <button 
                onClick={() => fetchStockData()} 
                disabled={loading}
                className="p-2 hover:bg-secondary rounded-full transition-colors text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            
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
            ) : (
              <div className="space-y-2">
                {stockData.map((stock) => (
                  <div 
                    key={stock.symbol} 
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border border-transparent ${
                      selectedSymbol === stock.symbol 
                        ? 'bg-secondary border-border shadow-sm' 
                        : 'hover:bg-secondary/50'
                    }`}
                    onClick={() => setSelectedSymbol(stock.symbol)}
                  >
                    <div>
                      <div className="font-bold">{stock.symbol}</div>
                      <div className="text-xs text-muted-foreground">{stock.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-medium">${stock.price.toFixed(2)}</div>
                      <div className={`text-xs font-medium flex items-center justify-end ${stock.change >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {stock.change >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* 这里可以放其他小组件，如市场情绪、新闻等 */}
          <div className="bg-gradient-to-br from-primary/10 to-transparent p-6 rounded-xl border border-primary/20">
            <h3 className="text-lg font-bold mb-2 text-primary">小贴士</h3>
            <p className="text-sm text-muted-foreground">
              使用搜索栏查找 Twelve Data 支持的任何股票、ETF 或加密货币对。
              尝试搜索 "BTC/USD" 或 "EUR/USD"。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
