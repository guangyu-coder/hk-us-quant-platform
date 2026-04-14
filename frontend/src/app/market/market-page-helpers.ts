export type MarketTab = 'US' | 'HK';
export type BoardMode = 'all' | 'gainers' | 'losers';
export type MarketInstrumentType = 'Common Stock' | 'ETF';
export type ChangePercentRange = {
  min?: number | null;
  max?: number | null;
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
