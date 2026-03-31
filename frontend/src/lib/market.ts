import type { MarketData, MarketDataMeta } from '@/types';

export const inferCurrency = (
  symbol?: string,
  exchange?: string,
  currency?: string
): string => {
  const normalizedCurrency = currency?.trim().toUpperCase();
  if (normalizedCurrency) {
    return normalizedCurrency;
  }

  const normalizedExchange = exchange?.trim().toUpperCase() ?? '';
  const normalizedSymbol = symbol?.trim().toUpperCase() ?? '';

  if (
    normalizedCurrency === 'HKD' ||
    normalizedExchange.includes('HK') ||
    normalizedExchange.includes('HONG KONG') ||
    normalizedSymbol.endsWith('.HK')
  ) {
    return 'HKD';
  }

  return 'USD';
};

export const getCurrencyPrefix = (currency?: string): string => {
  switch ((currency ?? '').toUpperCase()) {
    case 'HKD':
      return 'HK$';
    case 'MIXED':
      return '';
    case 'USD':
    default:
      return '$';
  }
};

export const getCurrencyLabel = (currency?: string): string => {
  switch ((currency ?? '').toUpperCase()) {
    case 'HKD':
      return '港币';
    case 'MIXED':
      return '混合币种';
    case 'USD':
    default:
      return '美元';
  }
};

export const formatMarketPrice = (
  value: number | undefined,
  options: {
    symbol?: string;
    exchange?: string;
    currency?: string;
    fallback?: string;
  } = {}
): string => {
  if (!Number.isFinite(value)) {
    return options.fallback ?? 'N/A';
  }

  const resolvedCurrency = inferCurrency(
    options.symbol,
    options.exchange,
    options.currency
  );

  return `${getCurrencyPrefix(resolvedCurrency)}${value!.toFixed(2)}`;
};

export const formatPortfolioAmount = (
  value: number | undefined,
  options: {
    currency?: string;
    fallback?: string;
  } = {}
): string => {
  if (!Number.isFinite(value)) {
    return options.fallback ?? 'N/A';
  }

  const currency = (options.currency ?? 'USD').toUpperCase();
  if (currency === 'MIXED') {
    return `${value!.toFixed(2)}`;
  }

  return formatMarketPrice(value, { currency });
};

export const formatMarketNumber = (
  value: number | undefined,
  options: { fallback?: string; digits?: number } = {}
): string => {
  if (!Number.isFinite(value)) {
    return options.fallback ?? 'N/A';
  }

  return (value as number).toFixed(options.digits ?? 2);
};

export const formatMarketVolume = (
  value: number | undefined,
  fallback = 'N/A'
): string => {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return (value as number).toLocaleString();
};

export const formatMarketTimestamp = (
  value: string | undefined,
  fallback = 'N/A'
): string => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

export const formatSignedMarketPrice = (
  value: number | undefined,
  options: {
    symbol?: string;
    exchange?: string;
    currency?: string;
    fallback?: string;
  } = {}
): string => {
  if (!Number.isFinite(value)) {
    return options.fallback ?? 'N/A';
  }

  const resolvedCurrency = inferCurrency(
    options.symbol,
    options.exchange,
    options.currency
  );
  const prefix = getCurrencyPrefix(resolvedCurrency);
  const numeric = value as number;

  return `${numeric >= 0 ? '+' : '-'}${prefix}${Math.abs(numeric).toFixed(2)}`;
};

export const getMarketCurrency = (marketData?: Partial<MarketData> | null): string => {
  return inferCurrency(marketData?.symbol, marketData?.exchange, marketData?.currency);
};

export const getMarketStatusLabel = (meta?: MarketDataMeta | null): string => {
  switch (meta?.status) {
    case 'live':
      return '实时';
    case 'degraded':
      return '降级';
    case 'error':
      return '不可用';
    default:
      return '未知';
  }
};
