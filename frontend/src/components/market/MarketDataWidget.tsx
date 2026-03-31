'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { marketDataApi } from '@/lib/api';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatMarketNumber, formatMarketPrice, formatMarketTimestamp, formatMarketVolume, getMarketCurrency, getMarketStatusLabel } from '@/lib/market';

export function MarketDataWidget({ symbol = 'AAPL' }: { symbol?: string }) {
  const { data: marketData, isLoading, error, refetch } = useQuery({
    queryKey: ['marketData', symbol],
    queryFn: () => marketDataApi.getRealTimeData(symbol),
    refetchInterval: 10000, // 改为10秒刷新一次，避免触发 API 限制
    retry: 1,
  });

  // 确保 symbol 变化时重新获取
  useEffect(() => {
    refetch();
  }, [symbol, refetch]);

  const displayData = marketData?.data ?? null;
  const meta = marketData?.meta;
  const currency = getMarketCurrency(displayData);

  const priceChange = displayData?.change ?? 0;
  const priceChangePercent = displayData?.change_percent ?? 0;
  const hasErrorState = !!error || meta?.status === 'error';

  if (hasErrorState) {
     return (
        <div className="bg-card text-card-foreground p-6 rounded-xl shadow-sm border border-destructive/20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold">实时行情 - {symbol}</h3>
          </div>
          <div className="text-destructive flex items-center text-sm">
             <span className="mr-2">●</span> 无法获取行情数据: {marketData?.error || (error as Error | undefined)?.message || meta?.message || '未知错误'}
          </div>
        </div>
     );
  }

  return (
    <div className="bg-card text-card-foreground p-6 rounded-xl shadow-sm border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">订单簿详情</h3>
        <span className={`text-xs px-2 py-1 rounded-full ${
          meta?.status === 'degraded'
            ? 'text-yellow-700 bg-yellow-100'
            : 'text-muted-foreground bg-secondary'
        }`}>
          {getMarketStatusLabel(meta)}
        </span>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-secondary rounded w-1/3"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-10 bg-secondary rounded"></div>
            <div className="h-10 bg-secondary rounded"></div>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-end space-x-3 mb-6">
            <span className="text-3xl font-mono font-bold tracking-tight">
              {formatMarketPrice(displayData?.price, {
                symbol: displayData?.symbol ?? symbol,
                exchange: displayData?.exchange,
                currency,
                fallback: formatMarketPrice(0, { currency }),
              })}
            </span>
            <div className={`flex items-center pb-1.5 ${priceChange >= 0 ? 'text-success' : 'text-destructive'}`}>
              {priceChange >= 0 ? (
                <TrendingUp className="h-4 w-4 mr-1" />
              ) : (
                <TrendingDown className="h-4 w-4 mr-1" />
              )}
              <span className="text-sm font-medium">
                {priceChange >= 0 ? '+' : ''}{formatMarketNumber(priceChange)} ({formatMarketNumber(priceChangePercent)}%)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-secondary/30 rounded-lg border border-border/50">
              <span className="text-xs text-muted-foreground block mb-1">买价 (Bid)</span>
              <div className="flex justify-between items-baseline">
                <span className="font-mono font-medium text-success">
                  {formatMarketPrice(displayData?.bid_price, {
                    symbol: displayData?.symbol ?? symbol,
                    exchange: displayData?.exchange,
                    currency,
                  })}
                </span>
                <span className="text-xs text-muted-foreground">x {formatMarketVolume(displayData?.bid_size)}</span>
              </div>
            </div>
            <div className="p-3 bg-secondary/30 rounded-lg border border-border/50">
              <span className="text-xs text-muted-foreground block mb-1">卖价 (Ask)</span>
              <div className="flex justify-between items-baseline">
                <span className="font-mono font-medium text-destructive">
                  {formatMarketPrice(displayData?.ask_price, {
                    symbol: displayData?.symbol ?? symbol,
                    exchange: displayData?.exchange,
                    currency,
                  })}
                </span>
                <span className="text-xs text-muted-foreground">x {formatMarketVolume(displayData?.ask_size)}</span>
              </div>
            </div>
            
            <div className="col-span-2 p-3 bg-secondary/30 rounded-lg border border-border/50 flex justify-between items-center">
              <span className="text-xs text-muted-foreground">成交量 (Volume)</span>
              <span className="font-mono font-medium">{formatMarketVolume(displayData?.volume)}</span>
            </div>
          </div>

          {meta?.status === 'degraded' && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
              当前行情为降级数据源 `{meta.source}`。{meta.message ? ` ${meta.message}` : ''}
            </div>
          )}

          <div className="mt-4 text-xs text-muted-foreground">
            更新时间: {formatMarketTimestamp(displayData?.timestamp)}
          </div>
          {marketData?.error && (
            <div className="mt-2 text-xs text-muted-foreground">
              {marketData.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
