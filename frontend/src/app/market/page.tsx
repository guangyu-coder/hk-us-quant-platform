'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { marketDataApi } from '@/lib/api';
import { formatMarketNumber, formatMarketPrice, inferCurrency } from '@/lib/market';
import type { MarketData, MarketInstrumentType, MarketMoverRecord, MarketQuoteResult, MarketSymbolRecord, MarketTab } from '@/types';
import { MarketModuleNav } from './_components/MarketModuleNav';
import {
  buildMarketModuleHref,
  filterSearchResultsByScope,
  filterStocksByChangePercentRange,
  getChangePercentRangeError,
  getMarketInstrumentTypeLabel,
  hasNextMarketPage,
  normalizeMarketSymbol,
  type BoardMode,
  type ChangePercentRange,
} from './market-page-helpers';

type DisplayStock = {
  symbol: string;
  instrumentName: string;
  exchange: string;
  country: string;
  instrumentType: MarketInstrumentType;
  market: MarketTab;
  currency: string;
  price?: number;
  change?: number;
  changePercent?: number;
  source: 'quotes' | 'snapshot';
};

const MARKET_TABS: Array<{ key: MarketTab; label: string }> = [
  { key: 'US', label: '美股' },
  { key: 'HK', label: '港股' },
];

const BOARD_OPTIONS: Array<{ key: BoardMode; label: string; description: string }> = [
  { key: 'all', label: '全部', description: '分页浏览当前市场股票池' },
  { key: 'gainers', label: '涨幅榜', description: '读取当日涨幅快照，优先看强势股' },
  { key: 'losers', label: '跌幅榜', description: '读取当日跌幅快照，快速找弱势股' },
];

const INSTRUMENT_TYPES: MarketInstrumentType[] = ['Common Stock', 'ETF'];
const PAGE_SIZE = 25;

const parseRangeInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapListRecordToDisplay = (
  record: MarketSymbolRecord,
  quote: Partial<MarketData> | null | undefined,
  market: MarketTab
): DisplayStock => ({
  symbol: normalizeMarketSymbol(record.symbol),
  instrumentName: record.instrument_name,
  exchange: record.exchange,
  country: record.country,
  instrumentType: record.instrument_type,
  market,
  currency: inferCurrency(record.symbol, record.exchange, quote?.currency),
  price: quote?.price,
  change: quote?.change,
  changePercent: quote?.change_percent,
  source: 'quotes',
});

const mapMoverRecordToDisplay = (record: MarketMoverRecord): DisplayStock => ({
  symbol: normalizeMarketSymbol(record.symbol),
  instrumentName: record.instrument_name,
  exchange: record.exchange,
  country: record.country,
  instrumentType: record.instrument_type,
  market: record.market,
  currency: inferCurrency(record.symbol, record.exchange, record.currency ?? undefined),
  price: record.price ?? undefined,
  change: record.change ?? undefined,
  changePercent: record.change_percent ?? undefined,
  source: 'snapshot',
});

export default function MarketPage() {
  const hasLoadedStocksRef = useRef(false);
  const [selectedMarket, setSelectedMarket] = useState<MarketTab>('US');
  const [selectedBoardMode, setSelectedBoardMode] = useState<BoardMode>('all');
  const [selectedInstrumentType, setSelectedInstrumentType] = useState<MarketInstrumentType>('Common Stock');
  const [currentPage, setCurrentPage] = useState(1);
  const [marketStocks, setMarketStocks] = useState<DisplayStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<ChangePercentRange>({ min: null, max: null });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MarketSymbolRecord[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [snapshotCapturedAt, setSnapshotCapturedAt] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const rangeError = getChangePercentRangeError(range);
  const filteredStocks = filterStocksByChangePercentRange(marketStocks, range);
  const visibleStocks = rangeError ? marketStocks : filteredStocks;
  const isAllMode = selectedBoardMode === 'all';
  const isSearching = searchQuery.trim().length > 0;
  const canGoNext = isAllMode && hasNextMarketPage(currentPage, pageSize, total);
  const canGoPrevious = isAllMode && currentPage > 1;

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMarket, selectedInstrumentType]);

  useEffect(() => {
    let cancelled = false;

    const loadStocks = async () => {
      setError(null);
      if (hasLoadedStocksRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        if (selectedBoardMode === 'all') {
          const listResponse = await marketDataApi.getMarketList({
            market: selectedMarket,
            instrumentType: selectedInstrumentType,
            page: currentPage,
            pageSize: PAGE_SIZE,
            activeOnly: true,
          });

          const symbols = listResponse.data
            .map((item) => normalizeMarketSymbol(item.symbol))
            .filter(Boolean);
          const quoteResults = symbols.length > 0
            ? await marketDataApi.getMultipleSymbols(symbols)
            : [];
          const quoteMap = new Map<string, MarketQuoteResult>();

          quoteResults.forEach((result) => {
            const key = normalizeMarketSymbol(
              result.meta?.normalized_symbol ?? result.data?.symbol ?? result.meta?.requested_symbol
            );
            if (key) {
              quoteMap.set(key, result);
            }
          });

          const nextStocks = listResponse.data.map((record) =>
            mapListRecordToDisplay(
              record,
              quoteMap.get(normalizeMarketSymbol(record.symbol))?.data,
              selectedMarket
            )
          );

          if (!cancelled) {
            setMarketStocks(nextStocks);
            setTotal(listResponse.total || listResponse.count || nextStocks.length);
            setPageSize(listResponse.page_size || PAGE_SIZE);
            setSnapshotCapturedAt(null);
            setLastUpdatedAt(new Date().toISOString());
            hasLoadedStocksRef.current = true;
          }
        } else {
          const movers = await marketDataApi.getMarketMovers(
            selectedMarket,
            selectedInstrumentType,
            selectedBoardMode
          );

          if (!cancelled) {
            setMarketStocks(movers.data.map(mapMoverRecordToDisplay));
            setTotal(movers.count);
            setPageSize(PAGE_SIZE);
            setSnapshotCapturedAt(movers.captured_at);
            setLastUpdatedAt(new Date().toISOString());
            hasLoadedStocksRef.current = true;
          }
        }
      } catch (loadError) {
        console.error('Failed to load market stocks', loadError);
        if (!cancelled) {
          setError('加载市场榜单失败，请稍后重试。');
          setMarketStocks([]);
          setTotal(0);
          setSnapshotCapturedAt(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    loadStocks();

    return () => {
      cancelled = true;
    };
  }, [selectedMarket, selectedBoardMode, selectedInstrumentType, currentPage, refreshNonce]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const response = await marketDataApi.searchSymbols(searchQuery.trim());
        if (!cancelled) {
          setSearchResults(
            filterSearchResultsByScope(response.data ?? [], selectedMarket, selectedInstrumentType)
          );
        }
      } catch (searchError) {
        console.error('Failed to search symbols', searchError);
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, selectedMarket, selectedInstrumentType]);

  const handleRangeChange = (key: 'min' | 'max', value: string) => {
    setRange((current) => ({
      ...current,
      [key]: parseRangeInput(value),
    }));
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSearchResults([]);
    setRange({ min: null, max: null });
    setCurrentPage(1);
  };

  const marketTitle = selectedMarket === 'US' ? '美股榜单' : '港股榜单';
  const showingEmptyByFilter = !loading && !error && marketStocks.length > 0 && visibleStocks.length === 0;
  const showingEmptyByUniverse = !loading && !error && marketStocks.length === 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <MarketModuleNav current="leaderboard" />

      <section className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-6 text-slate-50">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-300">
                Market Movers
              </p>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">{marketTitle}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  市场模块现在把榜单单独拉出来，专门用于浏览全市场股票、涨跌榜和区间筛选。
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">当前模式</div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {selectedBoardMode === 'all'
                    ? '分页全市场'
                    : selectedBoardMode === 'gainers'
                      ? '涨幅快照'
                      : '跌幅快照'}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">品类</div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {getMarketInstrumentTypeLabel(selectedInstrumentType)}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">最近刷新</div>
                <div className="mt-2 text-sm font-medium text-white">
                  {snapshotCapturedAt ?? lastUpdatedAt ?? '等待加载'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 px-6 py-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <div className="rounded-2xl border border-border bg-secondary/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                市场
              </p>
              <div className="mt-3 flex gap-2">
                {MARKET_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={selectedMarket === tab.key}
                    className={clsx(
                      'flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors',
                      selectedMarket === tab.key
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-background text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                    onClick={() => setSelectedMarket(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-secondary/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                榜单模式
              </p>
              <div className="mt-3 space-y-2">
                {BOARD_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    aria-label={option.label}
                    className={clsx(
                      'flex w-full items-start justify-between rounded-xl border px-3 py-3 text-left transition-colors',
                      selectedBoardMode === option.key
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-background hover:border-primary/40 hover:bg-secondary/40'
                    )}
                    onClick={() => {
                      setSelectedBoardMode(option.key);
                      setCurrentPage(1);
                    }}
                  >
                      <span>
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span
                          aria-hidden="true"
                          className="mt-1 block text-xs leading-5 text-muted-foreground"
                        >
                          {option.description}
                        </span>
                      </span>
                    {option.key === 'gainers' ? (
                      <TrendingUp className="mt-0.5 h-4 w-4 text-success" />
                    ) : option.key === 'losers' ? (
                      <TrendingDown className="mt-0.5 h-4 w-4 text-destructive" />
                    ) : (
                      <div className="mt-1 h-4 w-4 rounded-full border border-border" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-secondary/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                品类
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {INSTRUMENT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={clsx(
                      'rounded-xl px-4 py-2 text-sm font-medium transition-colors',
                      selectedInstrumentType === type
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-background text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                    onClick={() => setSelectedInstrumentType(type)}
                  >
                    {getMarketInstrumentTypeLabel(type)}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-secondary/20 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  涨跌幅区间
                </p>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:opacity-80"
                  onClick={handleResetFilters}
                >
                  重置筛选
                </button>
              </div>

              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-muted-foreground">最小涨跌幅</span>
                  <input
                    aria-label="最小涨跌幅"
                    type="number"
                    inputMode="decimal"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                    value={range.min ?? ''}
                    onChange={(event) => handleRangeChange('min', event.target.value)}
                    placeholder="例如 5"
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-muted-foreground">最大涨跌幅</span>
                  <input
                    aria-label="最大涨跌幅"
                    type="number"
                    inputMode="decimal"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                    value={range.max ?? ''}
                    onChange={(event) => handleRangeChange('max', event.target.value)}
                    placeholder="例如 -5"
                  />
                </label>

                {rangeError ? (
                  <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {rangeError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-secondary/20 p-4">
              <label className="block text-sm">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  搜索标的
                </span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    className="w-full rounded-xl border border-border bg-background pl-9 pr-3 py-2.5 text-sm outline-none transition focus:border-primary"
                    placeholder="搜索代码 (例如: AAPL)"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
              </label>

              {searchQuery.trim() ? (
                <div className="mt-3 rounded-xl border border-border bg-background">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
                    <span>当前范围搜索结果</span>
                    {searchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span>{searchResults.length} 条</span>}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {searchResults.length > 0 ? (
                      searchResults.map((item) => {
                        const symbol = normalizeMarketSymbol(item.symbol);
                        return (
                          <Link
                            key={`${item.symbol}-${item.instrument_type}`}
                            href={buildMarketModuleHref('/market/chart', symbol)}
                            aria-label={`打开 ${item.instrument_name} (${symbol}) 曲线页`}
                            className="flex items-center justify-between gap-3 border-b border-border px-3 py-3 text-sm last:border-b-0 hover:bg-secondary/40"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-foreground">{item.instrument_name}</div>
                              <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                                {symbol} · {item.exchange}
                              </div>
                            </div>
                            <span className="rounded-full bg-secondary px-2 py-1 text-[11px] text-muted-foreground">
                              {getMarketInstrumentTypeLabel(item.instrument_type)}
                            </span>
                          </Link>
                        );
                      })
                    ) : (
                      <p className="px-3 py-4 text-sm text-muted-foreground">
                        当前市场和品类范围内没有匹配结果。
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground">当前结果</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedBoardMode === 'all'
                    ? `当前展示 ${getMarketInstrumentTypeLabel(selectedInstrumentType)}，第 ${currentPage} 页，共 ${total} 只。`
                    : `当前展示 ${getMarketInstrumentTypeLabel(selectedInstrumentType)} 的${selectedBoardMode === 'gainers' ? '涨幅榜' : '跌幅榜'}快照。`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isAllMode ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      disabled={!canGoPrevious}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      上一页
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => setCurrentPage((page) => page + 1)}
                      disabled={!canGoNext}
                    >
                      下一页
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  onClick={() => setRefreshNonce((current) => current + 1)}
                >
                  {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  刷新榜单
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="grid grid-cols-[1.8fr_1.05fr_0.95fr_0.95fr_0.7fr] gap-3 border-b border-border bg-secondary/40 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span>标的</span>
                <span className="text-right">最新价</span>
                <span className="text-right">涨跌额</span>
                <span className="text-right">涨跌幅</span>
                <span className="text-right">操作</span>
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-3 px-6 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载市场股票池...
                </div>
              ) : error ? (
                <div className="px-6 py-12">
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm text-destructive">
                    {error}
                  </div>
                </div>
              ) : showingEmptyByUniverse ? (
                <div className="px-6 py-12">
                  <div className="rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-10 text-center">
                    <p className="text-lg font-medium text-foreground">当前市场暂无可展示股票</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      可以先切换市场或品类，也可以手动刷新一次榜单。
                    </p>
                  </div>
                </div>
              ) : showingEmptyByFilter ? (
                <div className="px-6 py-12">
                  <div className="rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-10 text-center">
                    <p className="text-lg font-medium text-foreground">当前筛选下暂无股票</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      放宽涨跌幅区间，或者点击“重置筛选”快速恢复。
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  {visibleStocks.map((stock) => {
                    const positive = (stock.change ?? 0) >= 0;
                    const changeClass = positive ? 'text-success' : 'text-destructive';
                    return (
                      <div
                        key={`${stock.symbol}-${stock.instrumentType}-${selectedBoardMode}`}
                        className="grid grid-cols-[1.8fr_1.05fr_0.95fr_0.95fr_0.7fr] gap-3 border-b border-border px-5 py-4 text-sm last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground">{stock.instrumentName}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{stock.symbol}</span>
                            <span>{stock.exchange}</span>
                            <span>{getMarketInstrumentTypeLabel(stock.instrumentType)}</span>
                            {stock.source === 'snapshot' ? (
                              <span className="rounded-full bg-secondary px-2 py-0.5">快照</span>
                            ) : null}
                          </div>
                        </div>

                        <div className="text-right font-mono font-semibold text-foreground">
                          {formatMarketPrice(stock.price, {
                            symbol: stock.symbol,
                            exchange: stock.exchange,
                            currency: stock.currency,
                          })}
                        </div>
                        <div className={clsx('text-right font-mono font-semibold', changeClass)}>
                          {stock.change !== undefined
                            ? `${positive ? '+' : ''}${formatMarketNumber(stock.change)}`
                            : 'N/A'}
                        </div>
                        <div className={clsx('text-right font-mono font-semibold', changeClass)}>
                          {stock.changePercent !== undefined
                            ? `${positive ? '+' : ''}${formatMarketNumber(stock.changePercent)}%`
                            : 'N/A'}
                        </div>
                        <div className="flex justify-end gap-2">
                          <Link
                            href={buildMarketModuleHref('/market/chart', stock.symbol)}
                            className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-secondary"
                          >
                            看曲线
                          </Link>
                          <Link
                            href={buildMarketModuleHref('/market/orderbook', stock.symbol)}
                            className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-secondary"
                          >
                            看订单簿
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-secondary/20 px-4 py-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">使用说明</p>
              <p className="mt-2 leading-6">
                “全部”模式走分页浏览，适合看完整股票池；“涨幅榜 / 跌幅榜”走后端 snapshot，更适合快速扫当日强弱股。
                区间筛选会在当前结果集上继续过滤，便于直接找出指定涨跌幅区间的股票。
              </p>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
