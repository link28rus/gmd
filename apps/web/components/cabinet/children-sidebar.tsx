'use client';

import { UserPlus } from 'lucide-react';
import type { ReactElement } from 'react';
import type { Child } from '@/lib/api/children';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import { CreateChildDialog } from '@/components/children/create-child-dialog';

interface Props {
  children: Child[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ChildrenSidebar({ children, selectedId, onSelect }: Props): ReactElement {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex-1 overflow-y-auto p-2">
        {children.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={`mb-1 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition ${
              selectedId === c.id ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-zinc-50'
            }`}
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: avatarColor(c.name) }}
            >
              <span className="text-sm font-semibold">{avatarInitial(c.name)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-900">{c.name}</div>
              <div className="truncate text-xs text-zinc-500">
                {c.device && c.device.revokedAt === null ? 'привязан' : 'не привязан'}
              </div>
            </div>
          </button>
        ))}
        {children.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-zinc-500">Детей пока нет</div>
        )}
      </div>
      <div className="border-t border-zinc-200 p-2">
        <CreateChildDialog
          trigger={
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
            >
              <UserPlus className="h-4 w-4" />
              Добавить ребёнка
            </button>
          }
        />
      </div>
    </aside>
  );
}
