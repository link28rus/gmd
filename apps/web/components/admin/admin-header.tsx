// apps/web/components/admin/admin-header.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, LayoutDashboard, Users, Home, Baby, Ticket, Settings2 } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/admin', label: 'Обзор', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Пользователи', icon: Users },
  { href: '/admin/families', label: 'Семьи', icon: Home },
  { href: '/admin/children', label: 'Дети', icon: Baby },
  { href: '/admin/invites', label: 'Приглашения', icon: Ticket },
  { href: '/admin/settings', label: 'Настройки', icon: Settings2 },
];

export function AdminHeader() {
  const pathname = usePathname();

  return (
    <header className="relative bg-slate-900 text-slate-100 shadow-[0_1px_2px_0_rgba(0,0,0,0.12)]">
      {/* Тонкий светящийся акцент сверху — даёт чувство «этот экран привилегированный». */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/70 to-transparent" />

      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:px-6">
        <div className="flex items-center gap-2 sm:mr-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/70" />
            <span className="relative h-2 w-2 rounded-full bg-sky-400" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300 sm:text-xs">
            Режим администратора
          </span>
        </div>

        {/* На мобильном nav прокручивается горизонтально — чтобы уместить
            все разделы без гамбургера. */}
        <nav className="-mx-4 flex items-center gap-0.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`relative shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'text-white' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {label}
                </span>
                {active && (
                  <span className="absolute inset-x-2 -bottom-[5px] h-[2px] rounded-full bg-sky-400" />
                )}
              </Link>
            );
          })}

          <span className="mx-2 hidden h-4 w-px bg-slate-700 sm:inline-block" />

          <Link
            href="/cabinet"
            className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-slate-400 transition hover:text-slate-100"
          >
            <span className="inline-flex items-center gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
              Кабинет
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
