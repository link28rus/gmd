'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { Download, Shield, ChevronDown, LogOut } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import { ThemeSwitcher } from '@/components/theme/theme-switcher';

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
          active
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
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
    <header className="relative z-20 border-b border-border bg-card text-foreground">
      <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4">
        {/* Лого + основной nav */}
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link href="/cabinet" className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white">
              <span className="text-xs font-bold">П</span>
            </div>
            {/* Текст лого скрыт на узких экранах — место уходит под nav. */}
            <div className="hidden flex-col leading-tight sm:flex">
              <span className="text-sm font-semibold text-foreground">Родительский контроль</span>
              <span className="text-[10px] text-muted-foreground">v{APP_VERSION}</span>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            {navLink('/cabinet', 'Главная')}
            {navLink('/cabinet/zones', 'Геозоны')}
          </nav>
        </div>

        {/* Правые кнопки */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* «Скачать приложение» — только на десктопе; на мобильном пункт
              доступен из profile-меню. */}
          <Link
            href="/cabinet/download"
            className="hidden items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:inline-flex"
          >
            <Download className="h-4 w-4" />
            Скачать приложение
          </Link>
          {/* Переключатель темы — между Download и Админкой. Скрыт на очень
              узких экранах, чтобы не ломать мобильный header. */}
          <div className="hidden sm:block">
            <ThemeSwitcher />
          </div>
          {isAdmin && (
            <Link
              href="/admin"
              aria-label="Админка"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2 py-1.5 text-sm font-medium text-white hover:bg-slate-800 sm:px-3"
            >
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Админка</span>
            </Link>
          )}
          {/* Профиль */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: color }}
              >
                <span className="text-xs font-semibold">{initial}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
            {menuOpen && user && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-56 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
              >
                <div className="border-b border-border px-3 py-2">
                  <div className="truncate text-sm font-medium text-foreground">
                    {user.name ?? user.email}
                  </div>
                  {user.name && (
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Перископ v{APP_VERSION}
                  </div>
                </div>
                {/* На мобильном показываем «Скачать приложение» тут, плюс
                    переключатель темы (на sm: он уже есть в header'е). */}
                <div className="sm:hidden">
                  <Link
                    href="/cabinet/download"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <Download className="h-4 w-4" />
                    Скачать приложение
                  </Link>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm text-muted-foreground">Тема</span>
                    <ThemeSwitcher />
                  </div>
                </div>
                <Link
                  href="/cabinet/password"
                  className="block px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  role="menuitem"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {user.hasPassword ? 'Сменить пароль' : 'Установить пароль'}
                </Link>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={logout}
                  className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
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
