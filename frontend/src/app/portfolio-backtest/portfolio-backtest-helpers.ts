export type PortfolioWeightLike = {
  symbol: string;
  targetWeight: number;
};

const WEIGHT_EPSILON = 0.0001;

export function calculatePortfolioWeightTotal(assets: PortfolioWeightLike[]): number {
  const total = assets.reduce((sum, asset) => sum + (Number.isFinite(asset.targetWeight) ? asset.targetWeight : 0), 0);
  return Number(total.toFixed(6));
}

export function formatPortfolioPercentage(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return `${(value * 100).toFixed(digits)}%`;
}

export function formatRebalancingFrequencyLabel(frequency: string): string {
  switch (frequency) {
    case 'daily':
      return '每日再平衡';
    case 'weekly':
      return '每周再平衡';
    case 'monthly':
      return '每月再平衡';
    default:
      return frequency;
  }
}

export function validatePortfolioWeights(assets: PortfolioWeightLike[]): {
  valid: boolean;
  total: number;
  message: string | null;
} {
  const total = calculatePortfolioWeightTotal(assets);

  if (assets.length < 2) {
    return { valid: false, total, message: '组合回测至少需要 2 个标的' };
  }

  const hasInvalidWeight = assets.some(
    (asset) => !asset.symbol.trim() || !Number.isFinite(asset.targetWeight) || asset.targetWeight <= 0
  );

  if (hasInvalidWeight) {
    return { valid: false, total, message: '每个标的都需要有效代码和正数权重' };
  }

  if (Math.abs(total - 1) > WEIGHT_EPSILON) {
    return { valid: false, total, message: '组合权重合计必须等于 100%' };
  }

  return { valid: true, total, message: null };
}

export function formatPortfolioCurrency(value: number | null | undefined, currency = 'USD'): string {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }

  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPortfolioDate(value: string | null | undefined): string {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
