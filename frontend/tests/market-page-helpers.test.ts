import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterSearchResultsByMarket,
  filterStocksByChangePercentRange,
  inferMarketFromSearchResult,
  getChangePercentRangeError,
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
