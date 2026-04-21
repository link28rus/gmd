'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { Download, Shield, ChevronDown, LogOut } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';

const APP_VERSION = process.env.APP_VERSION ?? '';

export function CabinetHeader(): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false);
  const clear = useAuthStore((s) => s.clear);
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    clear();
    router.push('/');
  }

  const navLink = (href: string, label: string): ReactElement => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`rounded-md px-3 py-1.5 text-sm transition ${
          active ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'
        }`}
      >
        {label}
      </Link>
    );
  };

  const displayName = user?.name || user?.email || '';
  const initial = avatarInitial(displayName);
  const color = avatarColor(displayName);

  return (
    <header className="relative z-20 border-b bg-white">
      <div className="flex items-center justify-between px-4 py-2">
        {/* Лого + основной nav */}
        <div className="flex items-center gap-6">
          <Link href="/cabinet" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white">
              <span className="text-xs font-bold">GMD</span>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-zinc-900">Где мои дети</span>
              <span className="text-[10px] text-zinc-400">v{APP_VERSION}</span>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            {navLink('/cabinet', 'Главная')}
            {navLink('/cabinet/zones', 'Геозоны')}
          </nav>
        </div>

        {/* Правые кнопки */}
        <div className="flex items-center gap-2">
          <Link
            href="/cabinet/download"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            <Download className="h-4 w-4" />
            Скачать приложение
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800"
            >
              <Shield className="h-4 w-4" />
              Админка
            </Link>
          )}
          {/* Профиль */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-100"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: color }}
              >
                <span className="text-xs font-semibold">{initial}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-zinc-400" />
            </button>
            {menuOpen && user && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-56 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg"
              >
                <div className="border-b border-zinc-100 px-3 py-2">
                  <div className="truncate text-sm font-medium text-zinc-900">
                    {user.name ?? user.email}
                  </div>
                  {user.name && <div className="truncate text-xs text-zinc-500">{user.email}</div>}
                  <div className="mt-1 text-[10px] text-zinc-400">GMD v{APP_VERSION}</div>
                </div>
                <Link
                  href="/cabinet/password"
                  className="block px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                  role="menuitem"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {user.hasPassword ? 'Сменить пароль' : 'Установить пароль'}
                </Link>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={logout}
                  className="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                  role="menuitem"
                >
                  <LogOut className="h-4 w-4" />
                  Выйти
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
