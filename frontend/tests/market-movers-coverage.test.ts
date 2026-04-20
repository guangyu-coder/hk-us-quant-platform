import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatMarketCoverageHint,
  formatMarketCoverageSummary,
} from '../src/app/market/market-page-helpers.ts';

test('formats movers coverage summary with covered and total counts', () => {
  assert.equal(
    formatMarketCoverageSummary({ covered: 63, total: 75, missing: 12, success_rate: 84 }),
    '真实覆盖 63 / 75'
  );
  assert.equal(
    formatMarketCoverageSummary({ covered: 0, total: 0, missing: 0, success_rate: 0 }),
    '真实覆盖 0 / 0'
  );
});

test('formats movers coverage hint with rounded success rate', () => {
  assert.equal(
    formatMarketCoverageHint({ covered: 63, total: 75, missing: 12, success_rate: 84 }),
    '成功率 84.0%，未覆盖 12 只'
  );
  assert.equal(
    formatMarketCoverageHint({ covered: 75, total: 75, missing: 0, success_rate: 100 }),
    '已覆盖全部 75 只股票'
  );
});
