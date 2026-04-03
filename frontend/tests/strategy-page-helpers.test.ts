import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCreateStrategyPayload,
  buildDeleteStrategyConfirmation,
  buildUpdateStrategyPayload,
  deriveStrategyCounts,
  normalizeStrategyCollection,
} from '../src/app/strategies/strategy-page-helpers.ts';

const strategyForm = {
  name: 'simple_moving_average' as const,
  display_name: '  Alpha Trend  ',
  description: 'desc',
  parameters: { symbol: 'AAPL', timeframe: '1d' },
  risk_limits: {},
  is_active: true,
};

test('strategy page helpers build trimmed create and update payloads', () => {
  assert.deepEqual(buildCreateStrategyPayload(strategyForm), {
    ...strategyForm,
    display_name: 'Alpha Trend',
  });

  assert.deepEqual(buildUpdateStrategyPayload(strategyForm), {
    name: 'simple_moving_average',
    display_name: 'Alpha Trend',
    description: 'desc',
    parameters: { symbol: 'AAPL', timeframe: '1d' },
    risk_limits: {},
    is_active: true,
  });
});

test('strategy page helpers keep delete copy and stats predictable', () => {
  assert.match(
    buildDeleteStrategyConfirmation({ name: 'mean_reversion', display_name: '  Gamma  ' }),
    /Gamma/
  );

  assert.deepEqual(
    deriveStrategyCounts([
      { is_active: true },
      { is_active: false },
      { is_active: false },
    ]),
    {
      totalCount: 3,
      activeCount: 1,
      inactiveCount: 2,
    }
  );
});

test('strategy page helpers normalize wrapped strategy responses', () => {
  assert.equal(normalizeStrategyCollection([{ id: 's-1' } as never]).length, 1);
  assert.equal(normalizeStrategyCollection({ strategies: [{ id: 's-2' } as never] }).length, 1);
  assert.deepEqual(normalizeStrategyCollection(undefined), []);
});
