'use client';

import { UserPlus, Users, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { Child } from '@/lib/api/children';
import { ChildAvatar } from '@/components/avatar/child-avatar';
import { CreateChildDialog } from '@/components/children/create-child-dialog';

interface Props {
  children: Child[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** v0.70.0: выбран пункт «Все» (общая карта семьи). */
  allSelected?: boolean;
  /** v0.70.0: пункт «Все» над списком детей; без обработчика пункта нет. */
  onSelectAll?: () => void;
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
  allSelected = false,
  onSelectAll,
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
        {onSelectAll && children.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onSelectAll();
              onCloseMobile?.();
            }}
            aria-current={allSelected ? 'page' : undefined}
            className={`mb-1 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition ${
              allSelected ? 'bg-accent/30 ring-1 ring-accent' : 'hover:bg-muted'
            }`}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
              aria-hidden="true"
            >
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">Все</div>
              <div className="truncate text-xs text-muted-foreground">Карта семьи</div>
            </div>
          </button>
        )}
        {children.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              onSelect(c.id);
              onCloseMobile?.();
            }}
            aria-current={!allSelected && selectedId === c.id ? 'page' : undefined}
            className={`mb-1 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition ${
              !allSelected && selectedId === c.id
                ? 'bg-accent/30 ring-1 ring-accent'
                : 'hover:bg-muted'
            }`}
          >
            <ChildAvatar name={c.name} avatarKey={c.avatarKey} childId={c.id} size={36} />
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
