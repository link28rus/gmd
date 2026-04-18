'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';

export function CabinetHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    clear();
    router.push('/');
  }

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`text-sm px-3 py-1.5 rounded-md ${
          active ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
        <nav className="flex items-center gap-1">
          {navLink('/cabinet', 'Главная')}
          {navLink('/cabinet/children', 'Мои дети')}
        </nav>
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          {user && <span className="truncate max-w-[220px]">{user.email}</span>}
          <Button variant="ghost" size="sm" onClick={logout}>
            Выйти
          </Button>
        </div>
      </div>
    </header>
  );
}
