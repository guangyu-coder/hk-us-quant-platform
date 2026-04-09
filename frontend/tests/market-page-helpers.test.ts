import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterSearchResultsByMarket,
  inferMarketFromSearchResult,
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
