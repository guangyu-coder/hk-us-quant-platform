import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMarketModuleHref,
  filterSearchResultsByMarket,
  filterSearchResultsByScope,
  filterStocksByChangePercentRange,
  getMarketBoardTone,
  formatMarketTimestamp,
  getMarketBoardModeLabel,
  getMarketInstrumentTypeLabel,
  inferMarketFromSearchResult,
  hasNextMarketPage,
  getChangePercentRangeError,
  normalizeMarketSymbol,
  normalizeSearchSymbol,
  sortStocksByBoardMode,
} from '../src/app/market/market-page-helpers.ts';

test('market helpers classify hk and us search results', () => {
  assert.equal(
    inferMarketFromSearchResult({ symbol: '0700.HK', exchange: 'HKEX', country: 'Hong Kong' }),
    'HK'
  );
  assert.equal(
    inferMarketFromSearchResult({ symbol: 'AAPL', exchange: 'NASDAQ', country: 'United States' }),
    'US'
  );
  assert.equal(
    inferMarketFromSearchResult({ symbol: '0005', exchange: 'Hong Kong', country: 'Hong Kong' }),
    'HK'
  );
});

test('normalizes search result symbols for hong kong stocks', () => {
  assert.equal(
    normalizeSearchSymbol({ symbol: '700', exchange: 'HKEX', country: 'Hong Kong' }),
    '0700.HK'
  );
  assert.equal(
    normalizeSearchSymbol({ symbol: 'AAPL', exchange: 'NASDAQ', country: 'United States' }),
    'AAPL'
  );
});

test('builds market-module hrefs with optional symbol preservation', () => {
  assert.equal(buildMarketModuleHref('/market/chart', 'AAPL'), '/market/chart?symbol=AAPL');
  assert.equal(buildMarketModuleHref('/market/orderbook', '700'), '/market/orderbook?symbol=0700.HK');
  assert.equal(buildMarketModuleHref('/market', ''), '/market');
});

test('normalizes standalone market symbols', () => {
  assert.equal(normalizeMarketSymbol('700'), '0700.HK');
  assert.equal(normalizeMarketSymbol('0700.HK'), '0700.HK');
  assert.equal(normalizeMarketSymbol('msft'), 'MSFT');
});

test('market helpers filter search results by selected market', () => {
  const items = [
    { symbol: 'AAPL', exchange: 'NASDAQ', country: 'United States' },
    { symbol: '0700.HK', exchange: 'HKEX', country: 'Hong Kong' },
    { symbol: 'MSFT', exchange: 'NASDAQ', country: 'United States' },
  ];

  assert.deepEqual(
    filterSearchResultsByMarket(items, 'US').map((item) => item.symbol),
    ['AAPL', 'MSFT']
  );
  assert.deepEqual(filterSearchResultsByMarket(items, 'HK').map((item) => item.symbol), ['0700.HK']);
});

test('market helpers filter search results by market and instrument type scope', () => {
  const items = [
    { symbol: 'AAPL', exchange: 'NASDAQ', country: 'United States', instrument_type: 'Common Stock' },
    { symbol: 'SPY', exchange: 'NYSE Arca', country: 'United States', instrument_type: 'ETF' },
    { symbol: '2800.HK', exchange: 'HKEX', country: 'Hong Kong', instrument_type: 'ETF' },
  ];

  assert.deepEqual(
    filterSearchResultsByScope(items, 'US', 'Common Stock').map((item) => item.symbol),
    ['AAPL']
  );
  assert.deepEqual(
    filterSearchResultsByScope(items, 'US', 'ETF').map((item) => item.symbol),
    ['SPY']
  );
});

test('market helpers sort gainers and losers by same day change percent', () => {
  const stocks = [
    { symbol: 'A', changePercent: -3.2 },
    { symbol: 'B', changePercent: 5.4 },
    { symbol: 'C', changePercent: 1.1 },
    { symbol: 'D', changePercent: null },
  ];

  assert.deepEqual(
    sortStocksByBoardMode(stocks, 'gainers').map((item) => item.symbol),
    ['B', 'C', 'A']
  );
  assert.deepEqual(
    sortStocksByBoardMode(stocks, 'losers').map((item) => item.symbol),
    ['A', 'C', 'B']
  );
  assert.deepEqual(sortStocksByBoardMode(stocks, 'all').map((item) => item.symbol), ['A', 'B', 'C', 'D']);
});

test('filters stocks by minimum and maximum daily change percent', () => {
  const stocks = [
    { symbol: 'AAPL', changePercent: 6.2 },
    { symbol: 'TSLA', changePercent: -4.5 },
    { symbol: 'MSFT', changePercent: 1.1 },
  ];

  const filtered = filterStocksByChangePercentRange(stocks, { min: -1, max: 5 });

  assert.deepEqual(
    filtered.map((item) => item.symbol),
    ['MSFT']
  );
});

test('accepts open-ended change percent ranges', () => {
  const stocks = [
    { symbol: 'AAPL', changePercent: 6.2 },
    { symbol: 'TSLA', changePercent: -4.5 },
    { symbol: 'MSFT', changePercent: 1.1 },
  ];

  assert.deepEqual(
    filterStocksByChangePercentRange(stocks, { min: 5 }).map((item) => item.symbol),
    ['AAPL']
  );
  assert.deepEqual(
    filterStocksByChangePercentRange(stocks, { max: -3 }).map((item) => item.symbol),
    ['TSLA']
  );
});

test('detects invalid change percent ranges', () => {
  assert.equal(getChangePercentRangeError({ min: 5, max: -1 }), '最小涨跌幅不能大于最大涨跌幅');
  assert.equal(getChangePercentRangeError({ min: -3, max: 5 }), null);
});

test('returns the original items unchanged when the change percent range is invalid', () => {
  const stocks = [
    { symbol: 'AAPL', changePercent: 6.2 },
    { symbol: 'TSLA', changePercent: -4.5 },
    { symbol: 'MSFT', changePercent: 1.1 },
  ];

  const filtered = filterStocksByChangePercentRange(stocks, { min: 5, max: -1 });

  assert.strictEqual(filtered, stocks);
  assert.deepEqual(
    filtered.map((item) => item.symbol),
    ['AAPL', 'TSLA', 'MSFT']
  );
});

test('returns the original items unchanged when the change percent range is empty', () => {
  const stocks = [
    { symbol: 'AAPL', changePercent: null },
    { symbol: 'TSLA', changePercent: -4.5 },
    { symbol: 'MSFT', changePercent: 1.1 },
  ];

  const filtered = filterStocksByChangePercentRange(stocks, {});

  assert.strictEqual(filtered, stocks);
  assert.deepEqual(
    filtered.map((item) => item.symbol),
    ['AAPL', 'TSLA', 'MSFT']
  );
  assert.deepEqual(
    filtered.map((item) => item.changePercent),
    [null, -4.5, 1.1]
  );
});

test('formats instrument type labels for market page controls', () => {
  assert.equal(getMarketInstrumentTypeLabel('Common Stock'), '普通股票');
  assert.equal(getMarketInstrumentTypeLabel('ETF'), 'ETF');
});

test('detects whether paginated market list has a next page', () => {
  assert.equal(hasNextMarketPage(1, 25, 100), true);
  assert.equal(hasNextMarketPage(4, 25, 100), false);
  assert.equal(hasNextMarketPage(2, 50, 75), false);
});

test('formats market timestamps into readable local strings', () => {
  assert.equal(formatMarketTimestamp(null), '等待加载');
  assert.match(formatMarketTimestamp('2026-04-15T06:19:42+00:00'), /\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/);
  assert.equal(formatMarketTimestamp('invalid-timestamp'), 'invalid-timestamp');
});

test('returns readable market board mode labels', () => {
  assert.equal(getMarketBoardModeLabel('all'), '全部股票');
  assert.equal(getMarketBoardModeLabel('gainers'), '涨幅榜');
  assert.equal(getMarketBoardModeLabel('losers'), '跌幅榜');
});

test('returns readable market board tones', () => {
  assert.equal(getMarketBoardTone('all'), 'neutral');
  assert.equal(getMarketBoardTone('gainers'), 'positive');
  assert.equal(getMarketBoardTone('losers'), 'negative');
});
