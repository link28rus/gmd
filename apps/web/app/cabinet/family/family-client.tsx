'use client';

import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { LogOut } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/auth-store';
import { refreshAccessToken } from '@/lib/auth/refresh-singleflight';
import { refreshSession } from '@/lib/auth/refresh-session';
import {
  familyErrorMessage,
  leaveFamily,
  transferOwnership,
  type FamilyMember,
} from '@/lib/api/family';
import { FAMILY_KEY, useFamilyMembers, useRemoveMember } from '@/lib/hooks/use-family';
import { FamilyNameCard } from './components/family-name-card';
import { MembersCard } from './components/members-card';
import { InviteCard } from './components/invite-card';
import { AddMemberCard } from './components/add-member-card';
import { JoinCodeCard } from './components/join-code-card';
import { ConfirmDialog } from './components/confirm-dialog';

export default function FamilyClient(): ReactElement {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAll = useAuthStore((s) => s.setAll);
  const [bootstrapping, setBootstrapping] = useState(accessToken === null);

  useEffect(() => {
    if (accessToken !== null) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await refreshAccessToken();
        if (cancelled) return;
        if (!data || !data.user || !data.family) {
          router.replace('/login');
          return;
        }
        setAll({ accessToken: data.accessToken, user: data.user, family: data.family });
      } catch {
        router.replace('/login');
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bootstrapping) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      </div>
    );
  }

  return <FamilyContent />;
}

function nameOf(m: FamilyMember): string {
  return m.displayName || m.email;
}

function FamilyContent(): ReactElement {
  const qc = useQueryClient();
  const membersQ = useFamilyMembers();
  const remove = useRemoveMember();

  const [transferTarget, setTransferTarget] = useState<FamilyMember | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<FamilyMember | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function onTransfer(): Promise<void> {
    if (!transferTarget) return;
    setTransferring(true);
    try {
      await transferOwnership(transferTarget.userId);
      // Роль в токене устарела (backend пометил его stale) — берём новый сразу.
      await refreshSession().catch(() => false);
      toast.success(`Владелец семьи теперь — ${nameOf(transferTarget)}`);
      setTransferTarget(null);
    } catch (e) {
      toast.error(familyErrorMessage(e));
    } finally {
      setTransferring(false);
      await qc.invalidateQueries({ queryKey: FAMILY_KEY });
    }
  }

  async function onRemove(): Promise<void> {
    if (!removeTarget) return;
    try {
      await remove.mutateAsync(removeTarget.userId);
      toast.success(`${nameOf(removeTarget)} больше не в семье`);
      setRemoveTarget(null);
    } catch (e) {
      toast.error(familyErrorMessage(e));
    }
  }

  async function onLeave(): Promise<void> {
    setLeaving(true);
    try {
      await leaveFamily();
    } catch (e) {
      toast.error(familyErrorMessage(e));
      setLeaving(false);
      return;
    }
    // Членство сменилось: новый токен с новой (пустой) семьёй и полная перезагрузка кабинета,
    // чтобы не осталось кэша детей/карты прежней семьи.
    await refreshSession().catch(() => false);
    window.location.assign('/cabinet');
  }

  if (membersQ.isPending) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </div>
    );
  }

  if (membersQ.isError) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <p className="mb-4 text-sm text-foreground">{familyErrorMessage(membersQ.error)}</p>
          <Button variant="outline" onClick={() => void membersQ.refetch()}>
            Повторить
          </Button>
        </div>
      </div>
    );
  }

  const { family, myRole, members } = membersQ.data;
  const isOwner = myRole === 'owner';
  const othersCount = members.filter((m) => !m.isMe).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="text-sm">
        <Link href="/cabinet" className="text-muted-foreground hover:text-foreground">
          ← В кабинет
        </Link>
      </div>

      <FamilyNameCard key={family.id + family.name} family={family} isOwner={isOwner} />

      <MembersCard
        members={members}
        isOwner={isOwner}
        onTransfer={setTransferTarget}
        onRemove={setRemoveTarget}
      />

      {isOwner && (
        <div className="space-y-3 pt-2">
          <div className="px-1">
            <h2 className="text-base font-semibold text-foreground">Добавить взрослого</h2>
            <p className="text-sm text-muted-foreground">
              Второй родитель, бабушка или няня получат полный доступ: дети, карта, геозоны, «Звук
              вокруг», SOS и уведомления. Два способа: пригласить по ссылке — человек сам входит или
              регистрируется, или создать аккаунт — вы задаёте email и пароль.
            </p>
          </div>
          <InviteCard />
          <AddMemberCard />
        </div>
      )}

      {!isOwner && (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-foreground">Выйти из семьи</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Вы потеряете доступ к детям, карте и уведомлениям семьи «{family.name}». Для вас будет
            создана новая пустая семья.
          </p>
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setLeaveOpen(true)}
          >
            <LogOut className="mr-1.5 h-4 w-4" />
            Выйти из семьи
          </Button>
        </section>
      )}
      {isOwner && othersCount > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Владелец не может выйти из семьи. Чтобы выйти, сначала сделайте владельцем другого
          участника.
        </p>
      )}

      <JoinCodeCard />

      <ConfirmDialog
        open={transferTarget !== null}
        onOpenChange={(v) => !v && setTransferTarget(null)}
        title="Передать права владельца?"
        description={
          transferTarget && (
            <>
              <p>
                Владельцем семьи «{family.name}» станет <b>{nameOf(transferTarget)}</b>.
              </p>
              <p>
                Вы останетесь родителем с доступом к детям, но больше не сможете переименовывать
                семью, приглашать и удалять участников. Вернуть права сможет только новый владелец.
              </p>
            </>
          )
        }
        confirmLabel="Передать права"
        pendingLabel="Передаём…"
        pending={transferring}
        onConfirm={() => void onTransfer()}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
        title="Удалить из семьи?"
        description={
          removeTarget && (
            <>
              <p>
                <b>{nameOf(removeTarget)}</b> сразу потеряет доступ к детям, карте, геозонам и
                перестанет получать уведомления семьи «{family.name}».
              </p>
              <p>
                Для него будет создана новая пустая семья. Вернуть его можно только новым
                приглашением.
              </p>
            </>
          )
        }
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        pending={remove.isPending}
        destructive
        onConfirm={() => void onRemove()}
      />

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Выйти из семьи?"
        description={
          <>
            <p>
              Вы потеряете доступ к детям, карте, геозонам и уведомлениям семьи «{family.name}».
            </p>
            <p>
              Для вас будет создана новая пустая семья. Вернуться можно только по новому приглашению
              владельца.
            </p>
          </>
        }
        confirmLabel="Выйти"
        pendingLabel="Выходим…"
        pending={leaving}
        destructive
        onConfirm={() => void onLeave()}
      />
    </div>
  );
}
