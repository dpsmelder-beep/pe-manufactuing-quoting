import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, FilePlus } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Layout() {
  const location = useLocation();
  const navItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'Customers', path: '/customers', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-body">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 flex-col z-30" style={{ backgroundColor: '#004D61' }}>
        {/* Logo */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            {/* PE bracket mark */}
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2" width="32" height="4" fill="#5BD1D7"/>
              <rect x="2" y="30" width="32" height="4" fill="#5BD1D7"/>
              <rect x="2" y="2" width="4" height="12" fill="#5BD1D7"/>
              <rect x="2" y="22" width="4" height="12" fill="#5BD1D7"/>
              <rect x="30" y="2" width="4" height="12" fill="#5BD1D7"/>
              <rect x="30" y="22" width="4" height="12" fill="#5BD1D7"/>
              <text x="10" y="24" fill="white" fontSize="14" fontWeight="700" fontFamily="Montserrat,sans-serif">PE</text>
            </svg>
            <div>
              <div className="text-white font-black text-sm tracking-widest uppercase leading-none">PE</div>
              <div className="text-white/80 font-light text-xs tracking-widest uppercase leading-none">Manufacturing</div>
            </div>
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
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm font-semibold tracking-wide',
                  active
                    ? 'text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                )}
                style={active ? { backgroundColor: '#5BD1D7', color: '#004D61' } : {}}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/10">
          <Link
            to="/quotes/new"
            className="flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-lg transition font-bold text-sm tracking-wide uppercase"
            style={{ backgroundColor: '#5BD1D7', color: '#004D61' }}
            onMouseOver={e => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={e => e.currentTarget.style.opacity = '1'}
          >
            <FilePlus className="w-4 h-4" />
            New Quote
          </Link>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between text-white px-4 py-3 sticky top-0 z-30" style={{ backgroundColor: '#004D61' }}>
        <div className="flex items-center gap-2">
          <span className="font-black text-sm tracking-widest uppercase">PE</span>
          <span className="text-white/70 font-light text-xs tracking-widest uppercase">Manufacturing</span>
        </div>
        <div className="flex gap-2">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn('p-1.5 rounded-lg', active ? 'text-white' : 'text-white/60')}
                style={active ? { backgroundColor: '#5BD1D7', color: '#004D61' } : {}}
              >
                <Icon className="w-5 h-5" />
              </Link>
            );
          })}
          <Link to="/quotes/new" className="p-1.5 rounded-lg" style={{ backgroundColor: '#5BD1D7', color: '#004D61' }}>
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