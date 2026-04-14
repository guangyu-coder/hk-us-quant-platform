'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import {
  buildMarketModuleHref,
  type MarketModulePath,
} from '../market-page-helpers';

type MarketModuleView = 'leaderboard' | 'chart' | 'orderbook';

const items: Array<{
  key: MarketModuleView;
  label: string;
  href: MarketModulePath;
}> = [
  { key: 'leaderboard', label: '榜单', href: '/market' },
  { key: 'chart', label: '股票曲线', href: '/market/chart' },
  { key: 'orderbook', label: '订单簿', href: '/market/orderbook' },
];

export function MarketModuleNav({
  current,
  symbol,
}: {
  current: MarketModuleView;
  symbol?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {items.map((item) => {
          const active = item.key === current;
          return (
            <Link
              key={item.key}
              href={buildMarketModuleHref(item.href, symbol)}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'rounded-xl px-4 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
