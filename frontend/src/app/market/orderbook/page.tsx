'use client';

import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MarketDataWidget } from '@/components/market/MarketDataWidget';
import { marketDataApi } from '@/lib/api';
import { formatMarketNumber, formatMarketPrice, getMarketStatusLabel, inferCurrency } from '@/lib/market';
import { MarketEmptyState } from '../_components/MarketEmptyState';
import { MarketModuleNav } from '../_components/MarketModuleNav';
import { normalizeMarketSymbol } from '../market-page-helpers';

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export default function MarketOrderbookPage() {
  const searchParams = useSearchParams();
  const symbol = normalizeMarketSymbol(searchParams.get('symbol'));
  const { data: quote, isLoading } = useQuery({
    queryKey: ['market-orderbook-summary', symbol],
    queryFn: () => marketDataApi.getRealTimeData(symbol),
    enabled: !!symbol,
    refetchInterval: 10000,
    retry: 1,
  });

  if (!symbol) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-6 p-6">
        <MarketModuleNav current="orderbook" />
        <MarketEmptyState
          title="还没有选择股票"
          description="订单簿页现在是独立页面。先从榜单里选择股票，或者直接打开 `/market/orderbook?symbol=0700.HK`。"
        />
      </div>
    );
  }

  const marketData = quote?.data ?? null;
  const currency = inferCurrency(marketData?.symbol ?? symbol, marketData?.exchange, marketData?.currency);
  const change = toFiniteNumber(marketData?.change);
  const changePercent = toFiniteNumber(marketData?.change_percent);
  const positive = change >= 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-6">
      <MarketModuleNav current="orderbook" symbol={symbol} />

      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-5">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Order Book
          </p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">{symbol}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                盘口页专注展示单只股票的实时买卖盘、成交量和行情状态，不再和榜单或曲线混排。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl border border-border bg-secondary/20 px-4 py-3">
                <div className="text-xs text-muted-foreground">最新价</div>
                <div className="mt-1 text-xl font-mono font-semibold text-foreground">
                  {formatMarketPrice(toFiniteNumber(marketData?.price), {
                    symbol,
                    exchange: marketData?.exchange,
                    currency,
                  })}
                </div>
              </div>
              <div
                className={`rounded-xl px-4 py-3 text-sm font-medium ${
                  positive ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                }`}
              >
                {change >= 0 ? '+' : ''}
                {formatMarketNumber(change)} ({formatMarketNumber(changePercent)}%)
              </div>
              <div className="rounded-xl bg-secondary px-4 py-3 text-xs font-medium text-secondary-foreground">
                {isLoading ? '加载中...' : getMarketStatusLabel(quote?.meta)}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-6">
          <MarketDataWidget symbol={symbol} />
        </div>
      </div>
    </div>
  );
}
