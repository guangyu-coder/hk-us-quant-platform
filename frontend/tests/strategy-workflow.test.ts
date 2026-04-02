import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMON_SYMBOL_SHORTCUTS,
  STRATEGY_TEMPLATE_SHORTCUTS,
  loadRecentSymbols,
  upsertRecentSymbol,
} from '../src/app/strategies/strategy-workflow.ts';

test('strategy workflow keeps symbol history deduped and capped', () => {
  const next = upsertRecentSymbol(['AAPL', 'MSFT', 'NVDA'], 'msft');

  assert.deepEqual(next, ['MSFT', 'AAPL', 'NVDA']);

  const capped = upsertRecentSymbol(
    ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', '0700.HK', '9988.HK'],
    'BABA'
  );

  assert.equal(capped.length, 8);
  assert.equal(capped[0], 'BABA');
});

test('strategy workflow ignores invalid localStorage payloads', () => {
  const storage = {
    getItem: () => 'not-json',
    setItem: () => undefined,
  };

  assert.deepEqual(loadRecentSymbols(storage), []);
});

test('strategy workflow exposes template and common symbol shortcuts', () => {
  assert.equal(STRATEGY_TEMPLATE_SHORTCUTS.length, 5);
  assert.ok(COMMON_SYMBOL_SHORTCUTS.includes('AAPL'));
  assert.ok(COMMON_SYMBOL_SHORTCUTS.includes('0700.HK'));
});
