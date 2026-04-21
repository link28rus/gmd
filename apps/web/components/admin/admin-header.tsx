// apps/web/components/admin/admin-header.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/families', label: 'Families' },
  { href: '/admin/children', label: 'Children' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/settings', label: 'Settings' },
];

export function AdminHeader() {
  const pathname = usePathname();

  return (
    <header className="bg-red-700 text-white shadow-md">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:px-6">
        <span className="text-xs font-semibold uppercase tracking-widest opacity-90 sm:mr-4 sm:text-sm">
          Режим администратора
        </span>
        {/* На мобильном nav прокручивается горизонтально — чтобы уместить
            все разделы без гамбургера. */}
        <nav className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {NAV_ITEMS.map(({ href, label }) => {
            const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`shrink-0 rounded px-3 py-1 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/20 text-white'
                    : 'text-red-100 hover:bg-white/10 hover:text-white'
                }`}
              >
                {label}
              </Link>
            );
          })}
          <span className="mx-2 hidden text-red-400 sm:inline">|</span>
          <Link
            href="/cabinet"
            className="shrink-0 rounded px-3 py-1 text-sm font-medium text-red-100 hover:bg-white/10 hover:text-white"
          >
            Назад в кабинет
          </Link>
        </nav>
      </div>
    </header>
  );
}
