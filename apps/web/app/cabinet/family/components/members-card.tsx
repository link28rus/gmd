'use client';

import type { ReactElement } from 'react';
import { Crown, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import type { FamilyMember } from '@/lib/api/family';

interface Props {
  members: FamilyMember[];
  isOwner: boolean;
  onTransfer: (m: FamilyMember) => void;
  onRemove: (m: FamilyMember) => void;
}

function RoleBadge({ role }: { role: FamilyMember['role'] }): ReactElement {
  return role === 'owner' ? (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
      Владелец
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Родитель
    </span>
  );
}

export function MembersCard({ members, isOwner, onTransfer, onRemove }: Props): ReactElement {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-foreground">Участники</h2>
      <ul className="divide-y divide-border">
        {members.map((m) => {
          const label = m.displayName || m.email;
          return (
            <li
              key={m.userId}
              className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: avatarColor(label) }}
                  aria-hidden="true"
                >
                  <span className="text-sm font-semibold">{avatarInitial(label)}</span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">{label}</span>
                    <RoleBadge role={m.role} />
                    {m.isMe && (
                      <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        Вы
                      </span>
                    )}
                  </div>
                  {m.displayName && m.displayName !== m.email && (
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  )}
                </div>
              </div>
              {isOwner && !m.isMe && (
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  <Button size="sm" variant="outline" onClick={() => onTransfer(m)}>
                    <Crown className="mr-1.5 h-4 w-4" />
                    Сделать владельцем
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onRemove(m)}
                  >
                    <UserMinus className="mr-1.5 h-4 w-4" />
                    Удалить из семьи
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
