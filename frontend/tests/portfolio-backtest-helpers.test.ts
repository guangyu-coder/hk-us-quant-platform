import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculatePortfolioWeightTotal,
  formatPortfolioPercentage,
  formatRebalancingFrequencyLabel,
  validatePortfolioWeights,
} from '../src/app/portfolio-backtest/portfolio-backtest-helpers.ts';

test('validatePortfolioWeights accepts a valid two-asset allocation', () => {
  const result = validatePortfolioWeights([
    { symbol: 'AAPL', targetWeight: 0.6 },
    { symbol: 'MSFT', targetWeight: 0.4 },
  ]);

  assert.equal(result.valid, true);
  assert.equal(result.total, 1);
  assert.equal(result.message, null);
});

test('validatePortfolioWeights rejects totals above 100 percent', () => {
  const result = validatePortfolioWeights([
    { symbol: 'AAPL', targetWeight: 0.7 },
    { symbol: 'MSFT', targetWeight: 0.4 },
  ]);

  assert.equal(result.valid, false);
  assert.equal(result.message, '组合权重合计必须等于 100%');
});

test('validatePortfolioWeights rejects totals below 100 percent', () => {
  const result = validatePortfolioWeights([
    { symbol: 'AAPL', targetWeight: 0.55 },
    { symbol: 'MSFT', targetWeight: 0.35 },
  ]);

  assert.equal(result.valid, false);
  assert.equal(result.message, '组合权重合计必须等于 100%');
});

test('validatePortfolioWeights rejects fewer than two assets', () => {
  const result = validatePortfolioWeights([{ symbol: 'AAPL', targetWeight: 1 }]);

  assert.equal(result.valid, false);
  assert.equal(result.message, '组合回测至少需要 2 个标的');
});

test('calculatePortfolioWeightTotal sums target weights precisely', () => {
  assert.equal(
    calculatePortfolioWeightTotal([
      { symbol: 'AAPL', targetWeight: 0.3333 },
      { symbol: 'MSFT', targetWeight: 0.3333 },
      { symbol: 'NVDA', targetWeight: 0.3334 },
    ]),
    1
  );
});

test('formatRebalancingFrequencyLabel returns readable labels', () => {
  assert.equal(formatRebalancingFrequencyLabel('daily'), '每日再平衡');
  assert.equal(formatRebalancingFrequencyLabel('weekly'), '每周再平衡');
  assert.equal(formatRebalancingFrequencyLabel('monthly'), '每月再平衡');
});

test('formatPortfolioPercentage returns readable percentages', () => {
  assert.equal(formatPortfolioPercentage(0.6), '60.0%');
  assert.equal(formatPortfolioPercentage(0.1234, 2), '12.34%');
});
