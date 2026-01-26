'use client';

import { DashboardOverview } from '@/components/dashboard/DashboardOverview';
import { MarketDataWidget } from '@/components/market/MarketDataWidget';
import { PortfolioSummary } from '@/components/portfolio/PortfolioSummary';
import { RecentTrades } from '@/components/trading/RecentTrades';
import { SystemStatus } from '@/components/system/SystemStatus';

export default function HomePage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">交易仪表板</h1>
        <SystemStatus />
      </div>
      
      <DashboardOverview />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <MarketDataWidget />
          <RecentTrades />
        </div>
        <div className="space-y-6">
          <PortfolioSummary />
        </div>
      </div>
    </div>
  );
}