import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, FilePlus, Factory } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Layout() {
  const location = useLocation();
  const navItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'Customers', path: '/customers', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 bg-slate-900 text-slate-300 flex-col z-30">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Factory className="w-6 h-6 text-white" />
            <span className="text-white font-semibold text-lg">QuoteFlow</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg transition',
                  active ? 'bg-slate-800 text-white' : 'hover:bg-slate-800'
                )}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <Link
            to="/quotes/new"
            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
          >
            <FilePlus className="w-4 h-4" />
            New Quote
          </Link>
        </div>
      </aside>

      <header className="md:hidden flex items-center justify-between bg-slate-900 text-white px-4 py-3 sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <Factory className="w-5 h-5" />
          <span className="font-semibold">QuoteFlow</span>
        </div>
        <div className="flex gap-3">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn('p-1.5 rounded-lg', active ? 'bg-slate-700' : 'hover:bg-slate-700')}
              >
                <Icon className="w-5 h-5" />
              </Link>
            );
          })}
          <Link to="/quotes/new" className="p-1.5 rounded-lg bg-blue-600">
            <FilePlus className="w-5 h-5" />
          </Link>
        </div>
      </header>

      <main className="md:ml-64">
        <Outlet />
      </main>
    </div>
  );
}