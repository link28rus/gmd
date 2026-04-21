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
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 py-2">
        <span className="mr-4 text-sm font-semibold uppercase tracking-widest opacity-90">
          Режим администратора
        </span>
        <nav className="flex flex-wrap items-center gap-1">
          {NAV_ITEMS.map(({ href, label }) => {
            const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/20 text-white'
                    : 'text-red-100 hover:bg-white/10 hover:text-white'
                }`}
              >
                {label}
              </Link>
            );
          })}
          <span className="mx-2 text-red-400">|</span>
          <Link
            href="/cabinet"
            className="rounded px-3 py-1 text-sm font-medium text-red-100 hover:bg-white/10 hover:text-white"
          >
            Назад в кабинет
          </Link>
        </nav>
      </div>
    </header>
  );
}
