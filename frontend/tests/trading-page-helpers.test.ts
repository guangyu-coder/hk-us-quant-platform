import assert from 'node:assert/strict';
import test from 'node:test';

import type { Order } from '../src/types/index.ts';
import {
  deriveTradingOrderCounts,
  normalizeOrdersCollection,
  selectTradingOrderId,
} from '../src/app/trading/trading-helpers.ts';

const orders: Order[] = [
  {
    id: 'order-1',
    symbol: 'AAPL',
    side: 'Buy',
    quantity: 10,
    order_type: 'Market',
    status: 'Pending',
    created_at: '2026-04-02T00:00:00Z',
    updated_at: '2026-04-02T00:00:00Z',
    filled_quantity: 0,
  },
  {
    id: 'order-2',
    symbol: 'MSFT',
    side: 'Sell',
    quantity: 20,
    order_type: 'Limit',
    status: 'PartiallyFilled',
    price: 100,
    created_at: '2026-04-02T00:00:00Z',
    updated_at: '2026-04-02T00:00:00Z',
    filled_quantity: 10,
  },
  {
    id: 'order-3',
    symbol: 'NVDA',
    side: 'Buy',
    quantity: 30,
    order_type: 'Market',
    status: 'Filled',
    created_at: '2026-04-02T00:00:00Z',
    updated_at: '2026-04-02T00:00:00Z',
    filled_quantity: 30,
  },
  {
    id: 'order-4',
    symbol: 'TSLA',
    side: 'Sell',
    quantity: 40,
    order_type: 'Stop',
    status: 'Rejected',
    stop_price: 250,
    created_at: '2026-04-02T00:00:00Z',
    updated_at: '2026-04-02T00:00:00Z',
    filled_quantity: 0,
  },
];

test('trading helpers normalize legacy payloads into an order list', () => {
  assert.deepEqual(normalizeOrdersCollection(orders), orders);
  assert.equal(normalizeOrdersCollection({ orders }).length, orders.length);
  assert.deepEqual(normalizeOrdersCollection({}), []);
  assert.deepEqual(normalizeOrdersCollection(null), []);
});

test('trading helpers keep the selected order stable when possible', () => {
  assert.equal(selectTradingOrderId([...orders], 'order-2'), 'order-2');
  assert.equal(selectTradingOrderId([...orders], 'missing'), 'order-1');
  assert.equal(selectTradingOrderId([], 'order-1'), null);
});

test('trading helpers derive order counts for the dashboard summary', () => {
  assert.deepEqual(deriveTradingOrderCounts([...orders]), {
    total: 4,
    open: 2,
    partiallyFilled: 1,
    filled: 1,
    terminal: 2,
  });
});
