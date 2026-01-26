'use client';

import { Bell, Settings, User } from 'lucide-react';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

export function Navbar() {
  return (
    <header className="bg-card/50 backdrop-blur-md border-b border-border px-6 py-4 sticky top-0 z-30">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h2 className="text-xl font-bold font-heading text-foreground tracking-tight">
            港美股量化交易平台
          </h2>
        </div>
        
        <div className="flex items-center space-x-3">
          <ThemeToggle />
          
          <button className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full transition-all duration-200 relative">
            <Bell className="h-5 w-5" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full border border-card"></span>
          </button>
          <button className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full transition-all duration-200">
            <Settings className="h-5 w-5" />
          </button>
          <div className="h-6 w-px bg-border mx-1"></div>
          <button className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full transition-all duration-200">
            <User className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}