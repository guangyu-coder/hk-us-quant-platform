import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBacktestExportFilename,
  canExportBacktests,
  toggleExpandedRunId,
} from '../src/app/backtest/backtest-page-helpers.ts';

test('backtest page helpers toggle expansion and export availability', () => {
  assert.equal(toggleExpandedRunId(null, 'run-1'), 'run-1');
  assert.equal(toggleExpandedRunId('run-1', 'run-1'), null);
  assert.equal(toggleExpandedRunId('run-1', 'run-2'), 'run-2');
  assert.equal(canExportBacktests(0), false);
  assert.equal(canExportBacktests(3), true);
});

test('backtest page helpers build deterministic export filenames', () => {
  const filename = buildBacktestExportFilename('filtered', new Date('2026-04-02T03:04:05.678Z'));
  assert.equal(filename, 'backtest-filtered-2026-04-02T03-04-05-678Z');
});
