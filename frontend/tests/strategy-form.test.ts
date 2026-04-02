import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStrategyFormStateFromStrategy,
  createStrategyFormState,
  inferStrategyPreset,
  normalizeSearchSymbol,
  updateStrategyFormPreset,
  validateStrategyForm,
} from '../src/lib/strategy-form.ts';

test('strategy form keeps empty edit descriptions empty', () => {
  const draft = buildStrategyFormStateFromStrategy({
    name: 'simple_moving_average',
    display_name: 'Custom SMA',
    description: '',
    parameters: {
      symbol: 'AAPL',
      timeframe: '1d',
      initial_capital: 100000,
      fee_bps: 5,
      slippage_bps: 2,
      max_position_fraction: 1,
      short_period: 5,
      long_period: 20,
    },
    risk_limits: {},
    is_active: true,
  });

  assert.equal(draft.description, '');
  assert.equal(draft.display_name, 'Custom SMA');
});

test('strategy form preset switching preserves empty edit descriptions', () => {
  const draft = updateStrategyFormPreset(
    {
      ...createStrategyFormState('simple_moving_average'),
      description: '',
      display_name: 'Custom SMA',
    },
    'rsi',
    true
  );

  assert.equal(draft.description, '');
  assert.equal(draft.display_name, 'Custom SMA');
});

test('strategy form helpers validate and normalize expected values', () => {
  assert.equal(
    validateStrategyForm('simple_moving_average', {
      symbol: 'AAPL',
      timeframe: '1d',
      initial_capital: 100000,
      fee_bps: 5,
      slippage_bps: 2,
      max_position_fraction: 1,
      short_period: 5,
      long_period: 20,
    }),
    null
  );

  assert.equal(
    normalizeSearchSymbol({ symbol: '700', exchange: 'HKEX', country: 'Hong Kong' }),
    '0700.HK'
  );

  assert.equal(
    inferStrategyPreset({
      name: 'My MACD',
      parameters: { fast_period: 12, slow_period: 26, signal_period: 9 },
    }),
    'macd'
  );
});
