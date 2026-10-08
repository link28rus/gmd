'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/auth-store';
import { FAMILY_NAME_MAX, familyErrorMessage } from '@/lib/api/family';
import { useRenameFamily } from '@/lib/hooks/use-family';

interface Props {
  family: { id: string; name: string };
  isOwner: boolean;
}

export function FamilyNameCard({ family, isOwner }: Props): ReactElement {
  const rename = useRenameFamily();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(family.name);

  function startEdit(): void {
    setValue(family.name);
    setEditing(true);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const name = value.trim();
    if (name.length === 0 || name.length > FAMILY_NAME_MAX) {
      toast.error(`Название — от 1 до ${FAMILY_NAME_MAX} символов`);
      return;
    }
    if (name === family.name) {
      setEditing(false);
      return;
    }
    try {
      const updated = await rename.mutateAsync({ id: family.id, name });
      // Название семьи лежит и в auth-store (persist) — обновим, чтобы не ждать refresh.
      const s = useAuthStore.getState();
      if (s.accessToken && s.user && s.family?.id === updated.id) {
        s.setAll({ accessToken: s.accessToken, user: s.user, family: updated });
      }
      toast.success('Название семьи сохранено');
      setEditing(false);
    } catch (err) {
      toast.error(familyErrorMessage(err));
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Семья</p>
      {editing ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            aria-label="Название семьи"
            value={value}
            maxLength={FAMILY_NAME_MAX}
            onChange={(e) => setValue(e.target.value)}
            disabled={rename.isPending}
            autoFocus
            className="sm:flex-1"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={rename.isPending}>
              {rename.isPending ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={rename.isPending}
            >
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-semibold text-foreground">
            {family.name}
          </h1>
          {isOwner && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={startEdit}
              aria-label="Переименовать семью"
              title="Переименовать семью"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
      <p className="mt-2 text-sm text-muted-foreground">
        Все взрослые семьи видят одних и тех же детей, карту и геозоны и получают уведомления.
        Приглашать и удалять участников может только владелец.
      </p>
    </section>
  );
}
