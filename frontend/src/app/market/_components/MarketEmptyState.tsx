'use client';

import Link from 'next/link';

export function MarketEmptyState({
  title,
  description,
  symbol,
}: {
  title: string;
  description: string;
  symbol?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center shadow-sm">
      <div className="mx-auto max-w-md space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Market Module
        </p>
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        {symbol ? (
          <p className="text-sm text-foreground">
            当前参数中的股票代码：<span className="font-mono font-semibold">{symbol}</span>
          </p>
        ) : null}
        <div className="pt-2">
          <Link
            href="/market"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            返回榜单挑选股票
          </Link>
        </div>
      </div>
    </div>
  );
}
