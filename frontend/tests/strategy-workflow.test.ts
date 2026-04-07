import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMON_SYMBOL_SHORTCUTS,
  STRATEGY_TEMPLATE_SHORTCUTS,
  buildDefaultBacktestParameterSets,
  loadRecentSymbols,
  parseBacktestParameterSets,
  serializeBacktestParameterSets,
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

test('strategy workflow builds and parses minimal batch parameter sets', () => {
  const defaultSets = buildDefaultBacktestParameterSets({
    name: 'simple_moving_average',
    parameters: {
      short_period: 5,
      long_period: 20,
    },
  }) as Array<Record<string, unknown>>;

  assert.equal(defaultSets.length, 2);
  assert.equal(defaultSets[0]?.['short_period'], 5);
  assert.equal(defaultSets[1]?.['long_period'], 25);

  const serialized = serializeBacktestParameterSets(defaultSets);
  const parsed = parseBacktestParameterSets(serialized);

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.parameterSets.length, 2);
  assert.equal(parsed.parameterSets[0]?.['short_period'], 5);
});

test('strategy workflow rejects invalid batch payloads', () => {
  assert.match(parseBacktestParameterSets('[]').error ?? '', /2 到 5/);
  assert.match(parseBacktestParameterSets('{}').error ?? '', /JSON 数组/);
});
