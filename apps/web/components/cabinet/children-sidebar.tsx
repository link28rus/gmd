'use client';

import { UserPlus, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { Child } from '@/lib/api/children';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import { CreateChildDialog } from '@/components/children/create-child-dialog';

interface Props {
  children: Child[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Управление drawer-режимом для узких экранов. Когда `mobileOpen=true`,
   * сайдбар рендерится как overlay поверх карты с backdrop. На десктопе
   * (>= md) всегда видимая колонка слева — оба флага игнорируются.
   */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function ChildrenSidebar({
  children,
  selectedId,
  onSelect,
  mobileOpen = false,
  onCloseMobile,
}: Props): ReactElement {
  const sidebar = (
    <>
      <div className="flex items-center justify-between border-b border-border px-3 py-2 md:hidden">
        <span className="text-sm font-semibold text-foreground">Мои дети</span>
        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Закрыть"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {children.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              onSelect(c.id);
              onCloseMobile?.();
            }}
            className={`mb-1 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition ${
              selectedId === c.id ? 'bg-accent/30 ring-1 ring-accent' : 'hover:bg-muted'
            }`}
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: avatarColor(c.name) }}
            >
              <span className="text-sm font-semibold">{avatarInitial(c.name)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {c.device && c.device.revokedAt === null ? 'привязан' : 'не привязан'}
              </div>
            </div>
          </button>
        ))}
        {children.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">Детей пока нет</div>
        )}
      </div>
      <div className="border-t border-border p-2">
        <CreateChildDialog
          trigger={
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <UserPlus className="h-4 w-4" />
              Добавить ребёнка
            </button>
          }
        />
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: постоянная колонка */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-card md:flex">
        {sidebar}
      </aside>
      {/* Mobile: drawer с backdrop */}
      <div
        className={`fixed inset-0 z-30 md:hidden ${mobileOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!mobileOpen}
      >
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={onCloseMobile}
        />
        <aside
          className={`absolute left-0 top-0 flex h-full w-[min(280px,85vw)] flex-col border-r border-border bg-card shadow-xl transition-transform ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {sidebar}
        </aside>
      </div>
    </>
  );
}
