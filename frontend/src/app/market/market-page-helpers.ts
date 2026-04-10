export type MarketTab = 'US' | 'HK';
export type BoardMode = 'all' | 'gainers' | 'losers';
export type ChangePercentRange = {
  min?: number | null;
  max?: number | null;
};

type MarketLike = {
  symbol?: string | null;
  exchange?: string | null;
  country?: string | null;
};

type StockLike = {
  changePercent?: number | null;
};

const toUpper = (value: string | null | undefined): string => value?.trim().toUpperCase() ?? '';

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

export const filterSearchResultsByMarket = <T extends MarketLike>(items: T[], market: MarketTab): T[] =>
  items.filter((item) => inferMarketFromSearchResult(item) === market);

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
