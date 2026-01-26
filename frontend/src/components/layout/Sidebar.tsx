'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  BarChart3, 
  TrendingUp, 
  Wallet, 
  Settings, 
  Shield, 
  Activity,
  Home,
  FileText
} from 'lucide-react';
import { clsx } from 'clsx';

const navigation = [
  { name: '仪表盘', href: '/', icon: Home },
  { name: '市场行情', href: '/market', icon: TrendingUp },
  { name: '策略管理', href: '/strategies', icon: BarChart3 },
  { name: '交易执行', href: '/trading', icon: Activity },
  { name: '投资组合', href: '/portfolio', icon: Wallet },
  { name: '风险控制', href: '/risk', icon: Shield },
  { name: '回测系统', href: '/backtest', icon: FileText },
  { name: '系统设置', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col w-64 bg-card border-r border-border h-full">
      <div className="flex items-center h-16 px-6 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold font-heading tracking-tight">量化交易终端</h1>
        </div>
      </div>
      
      <nav className="flex-1 px-3 py-6 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-all duration-200 group',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <item.icon className={clsx(
                "w-5 h-5 mr-3 transition-colors",
                isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
              )} />
              {item.name}
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-border bg-secondary/20">
        <div className="flex items-center">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary to-blue-600 flex items-center justify-center text-primary-foreground font-bold shadow-sm">
            T
          </div>
          <div className="ml-3">
            <p className="text-sm font-semibold text-foreground">交易员</p>
            <div className="flex items-center mt-0.5">
              <span className="w-2 h-2 bg-success rounded-full mr-1.5"></span>
              <p className="text-xs text-muted-foreground">在线</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}