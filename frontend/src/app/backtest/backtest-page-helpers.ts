export function toggleExpandedRunId(
  currentRunId: string | null,
  targetRunId: string
): string | null {
  return currentRunId === targetRunId ? null : targetRunId;
}

export function canExportBacktests(resultCount: number): boolean {
  return resultCount > 0;
}

export function buildBacktestExportFilename(scope: string, timestamp = new Date()) {
  return `backtest-${scope}-${timestamp.toISOString().replace(/[:.]/g, '-')}`;
}
