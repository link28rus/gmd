'use client';

import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Copy, Link as LinkIcon, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import {
  MAX_ACTIVE_MEMBER_INVITES,
  MEMBER_INVITE_TTL_DAYS,
  familyErrorMessage,
  formatInviteCode,
  type MemberInvite,
} from '@/lib/api/family';
import {
  useCreateMemberInvite,
  useMemberInvites,
  useRevokeMemberInvite,
} from '@/lib/hooks/use-family';

export function formatInviteUntil(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function copyWithToast(text: string, successMsg: string): Promise<void> {
  if (await copyText(text)) toast.success(successMsg);
  else toast.error('Не удалось скопировать — выделите и скопируйте вручную');
}

export function InviteCard(): ReactElement {
  const invitesQ = useMemberInvites(true);
  const create = useCreateMemberInvite();
  const revoke = useRevokeMemberInvite();
  const [fresh, setFresh] = useState<MemberInvite | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function onCreate(): Promise<void> {
    try {
      setFresh(await create.mutateAsync());
    } catch (e) {
      toast.error(familyErrorMessage(e));
    }
  }

  async function onRevoke(id: string): Promise<void> {
    setRevokingId(id);
    try {
      await revoke.mutateAsync(id);
      if (fresh?.id === id) setFresh(null);
      toast.success('Приглашение отозвано');
    } catch (e) {
      toast.error(familyErrorMessage(e));
    } finally {
      setRevokingId(null);
    }
  }

  const all = invitesQ.data ?? [];
  const others = all.filter((i) => i.id !== fresh?.id);
  const limitReached = all.length >= MAX_ACTIVE_MEMBER_INVITES;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-foreground">Пригласить взрослого</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Второй родитель, бабушка или няня получат полный доступ: дети, карта, геозоны, «Звук
        вокруг», SOS и уведомления. Отправьте ссылку или код в мессенджере — письмо сервер не
        отправляет. Приглашение одноразовое и действует {MEMBER_INVITE_TTL_DAYS} дней.
      </p>

      {fresh ? (
        <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Код приглашения
          </p>
          <p
            className="mb-3 select-all text-center font-mono text-3xl font-semibold tracking-[0.2em] text-foreground sm:text-4xl"
            aria-label={`Код приглашения ${fresh.code}`}
          >
            {formatInviteCode(fresh.code)}
          </p>
          <label htmlFor="invite-url" className="mb-1 block text-xs text-muted-foreground">
            Ссылка
          </label>
          <input
            id="invite-url"
            readOnly
            value={fresh.url}
            onFocus={(e) => e.currentTarget.select()}
            className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copyWithToast(fresh.url, 'Ссылка скопирована')}>
              <LinkIcon className="mr-1.5 h-4 w-4" />
              Копировать ссылку
            </Button>
            <Button
              variant="outline"
              onClick={() => void copyWithToast(fresh.code, 'Код скопирован')}
            >
              <Copy className="mr-1.5 h-4 w-4" />
              Копировать код
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={revokingId === fresh.id}
              onClick={() => void onRevoke(fresh.id)}
            >
              {revokingId === fresh.id ? 'Отзываем…' : 'Отозвать'}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Действует до {formatInviteUntil(fresh.expiresAt)}, одноразовое. Приглашённый откроет
            ссылку, войдёт или зарегистрируется и нажмёт «Присоединиться».
          </p>
        </div>
      ) : null}

      <Button onClick={() => void onCreate()} disabled={create.isPending || limitReached}>
        <UserPlus className="mr-1.5 h-4 w-4" />
        {create.isPending ? 'Создаём…' : fresh ? 'Создать ещё приглашение' : 'Пригласить взрослого'}
      </Button>
      {limitReached && (
        <p className="mt-2 text-xs text-muted-foreground">
          Активных приглашений уже {MAX_ACTIVE_MEMBER_INVITES} — отзовите ненужные, чтобы создать
          новое.
        </p>
      )}

      {invitesQ.isError && (
        <p className="mt-4 text-sm text-destructive">{familyErrorMessage(invitesQ.error)}</p>
      )}

      {others.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Активные приглашения</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {others.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-mono text-sm font-semibold tracking-widest text-foreground">
                    {formatInviteCode(inv.code)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    действует до {formatInviteUntil(inv.expiresAt)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copyWithToast(inv.url, 'Ссылка скопирована')}
                  >
                    <LinkIcon className="mr-1.5 h-4 w-4" />
                    Копировать ссылку
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={revokingId === inv.id}
                    onClick={() => void onRevoke(inv.id)}
                  >
                    <X className="mr-1.5 h-4 w-4" />
                    {revokingId === inv.id ? 'Отзываем…' : 'Отозвать'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
