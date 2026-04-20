export type MarketTab = 'US' | 'HK';
export type BoardMode = 'all' | 'gainers' | 'losers';
export type MarketInstrumentType = 'Common Stock' | 'ETF';
export type ChangePercentRange = {
  min?: number | null;
  max?: number | null;
};
export type MarketMoversCoverage = {
  covered: number;
  total: number;
  missing: number;
  success_rate: number;
};

export type MarketMissingSymbol = {
  symbol: string;
  instrument_name: string;
};

export type MarketModulePath = '/market' | '/market/chart' | '/market/orderbook';

type MarketLike = {
  symbol?: string | null;
  exchange?: string | null;
  country?: string | null;
  instrument_type?: string | null;
};

type StockLike = {
  changePercent?: number | null;
};

const toUpper = (value: string | null | undefined): string => value?.trim().toUpperCase() ?? '';

export const normalizeMarketSymbol = (value: string | null | undefined): string => {
  const rawSymbol = toUpper(value);

  if (!rawSymbol) {
    return '';
  }

  if (rawSymbol.endsWith('.HK')) {
    return rawSymbol;
  }

  if (/^\d+$/.test(rawSymbol)) {
    return `${rawSymbol.length >= 4 ? rawSymbol : rawSymbol.padStart(4, '0')}.HK`;
  }

  return rawSymbol;
};

export const inferMarketFromSearchResult = (item: MarketLike): MarketTab => {
  const symbol = toUpper(item.symbol);
  const exchange = toUpper(item.exchange);
  const country = toUpper(item.country);

  const isHongKong =
    symbol.endsWith('.HK') ||
    exchange.includes('HKEX') ||
    exchange.includes('HONG KONG') ||
    exchange.includes('HK') ||
    country.includes('HONG KONG');

  return isHongKong ? 'HK' : 'US';
};

export const normalizeSearchSymbol = <T extends MarketLike>(item: T): string => {
  const rawSymbol = toUpper(item.symbol);
  const exchange = toUpper(item.exchange);
  const country = toUpper(item.country);

  if (!rawSymbol) {
    return '';
  }

  if (rawSymbol.endsWith('.HK')) {
    return rawSymbol;
  }

  const isHongKong =
    country.includes('HONG KONG') ||
    exchange.includes('HK') ||
    exchange.includes('HONG KONG');

  if (isHongKong && /^\d+$/.test(rawSymbol)) {
    return normalizeMarketSymbol(rawSymbol);
  }

  return rawSymbol;
};

export const filterSearchResultsByMarket = <T extends MarketLike>(items: T[], market: MarketTab): T[] =>
  items.filter((item) => inferMarketFromSearchResult(item) === market);

export const filterSearchResultsByScope = <T extends MarketLike>(
  items: T[],
  market: MarketTab,
  instrumentType: MarketInstrumentType
): T[] =>
  items.filter((item) => {
    if (inferMarketFromSearchResult(item) !== market) {
      return false;
    }

    if (!item.instrument_type) {
      return true;
    }

    return item.instrument_type === instrumentType;
  });

export const buildMarketModuleHref = (
  path: MarketModulePath,
  symbol?: string | null
): string => {
  const normalizedSymbol = normalizeMarketSymbol(symbol);

  if (!normalizedSymbol) {
    return path;
  }

  return `${path}?symbol=${encodeURIComponent(normalizedSymbol)}`;
};

export const getChangePercentRangeError = (range: ChangePercentRange): string | null => {
  if (
    typeof range.min === 'number' &&
    typeof range.max === 'number' &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max) &&
    range.min > range.max
  ) {
    return '最小涨跌幅不能大于最大涨跌幅';
  }

  return null;
};

export const filterStocksByChangePercentRange = <T extends StockLike>(
  items: T[],
  range: ChangePercentRange
): T[] => {
  if (getChangePercentRangeError(range)) {
    return items;
  }

  const hasMin = typeof range.min === 'number' && Number.isFinite(range.min);
  const hasMax = typeof range.max === 'number' && Number.isFinite(range.max);
  const minValue: number | null = hasMin ? (range.min ?? null) : null;
  const maxValue: number | null = hasMax ? (range.max ?? null) : null;

  if (!hasMin && !hasMax) {
    return items;
  }

  return items.filter((item) => {
    if (!Number.isFinite(item.changePercent)) {
      return false;
    }

    const value = item.changePercent ?? 0;

    if (minValue !== null && value < minValue) {
      return false;
    }

    if (maxValue !== null && value > maxValue) {
      return false;
    }

    return true;
  });
};

export const sortStocksByBoardMode = <T extends StockLike>(items: T[], mode: BoardMode): T[] => {
  if (mode === 'all') {
    return [...items];
  }

  const direction = mode === 'gainers' ? -1 : 1;

  return [...items]
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Number.isFinite(item.changePercent))
    .sort((left, right) => {
      const leftChange = left.item.changePercent ?? 0;
      const rightChange = right.item.changePercent ?? 0;

      if (leftChange === rightChange) {
        return left.index - right.index;
      }

      return (leftChange - rightChange) * direction;
    })
    .map(({ item }) => item);
};

export const getMarketInstrumentTypeLabel = (instrumentType: MarketInstrumentType): string =>
  instrumentType === 'Common Stock' ? '普通股票' : 'ETF';

export const hasNextMarketPage = (
  page: number,
  pageSize: number,
  total: number
): boolean => page * pageSize < total;

export const formatMarketTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return '等待加载';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

export const getMarketBoardModeLabel = (mode: BoardMode): string => {
  if (mode === 'all') {
    return '全部股票';
  }

  return mode === 'gainers' ? '涨幅榜' : '跌幅榜';
};

export const getMarketBoardTone = (mode: BoardMode): 'neutral' | 'positive' | 'negative' => {
  if (mode === 'gainers') {
    return 'positive';
  }

  if (mode === 'losers') {
    return 'negative';
  }

  return 'neutral';
};

export const formatMarketCoverageSummary = (coverage: MarketMoversCoverage): string =>
  `真实覆盖 ${coverage.covered} / ${coverage.total}`;

export const formatMarketCoverageHint = (coverage: MarketMoversCoverage): string => {
  const missing = typeof coverage.missing === 'number'
    ? coverage.missing
    : Math.max(coverage.total - coverage.covered, 0);

  if (coverage.total > 0 && coverage.covered >= coverage.total) {
    return `已覆盖全部 ${coverage.total} 只股票`;
  }

  return `成功率 ${coverage.success_rate.toFixed(1)}%，未覆盖 ${missing} 只`;
};

export const formatMissingSymbolsPreview = (
  items: MarketMissingSymbol[],
  maxItems = 3
): string => {
  if (items.length === 0) {
    return '当前没有缺失标的';
  }

  const preview = items
    .slice(0, maxItems)
    .map((item) => item.symbol)
    .join('、');

  if (items.length <= maxItems) {
    return `缺失标的：${preview}`;
  }

  return `缺失标的：${preview} 等 ${items.length} 只`;
};
