export type MarketTab = 'US' | 'HK';
export type BoardMode = 'all' | 'gainers' | 'losers';

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
