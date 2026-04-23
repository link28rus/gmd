'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement } from 'react';
import { MoreVertical, Shield, ShieldOff, Lock, Unlock, KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, type UserRow } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

type ModalKind = 'block' | 'reset' | 'delete' | null;

interface Props {
  row: UserRow;
  /** ID текущего админа — чтобы скрыть «сам-себя» действия. */
  currentUserId: string | null;
}

export function UserActionsMenu({ row, currentUserId }: Props): ReactElement | null {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [blockReason, setBlockReason] = useState('');
  /**
   * Меню рендерится через portal в document.body — иначе его клипает
   * overflow-x-auto у DataTable и дропдаун обрезается снизу.
   * Координаты пересчитываются при открытии и при скролле/resize окна.
   */
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_WIDTH = 224; // w-56

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const reposition = (): void => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - MENU_WIDTH),
      });
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const isSelf = currentUserId === row.id;
  const isDeleted = row.deletedAt !== null;

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
  }

  const roleMut = useMutation({
    mutationFn: (nextRole: 'admin' | 'parent') => adminApi.setUserRole(row.id, nextRole),
    onSuccess: () => {
      toast.success(
        row.role === 'admin' ? 'Права администратора сняты' : 'Назначены права администратора',
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось изменить роль'),
  });

  const blockMut = useMutation({
    mutationFn: (reason: string) => adminApi.blockUser(row.id, reason),
    onSuccess: () => {
      toast.success('Пользователь заблокирован');
      setModal(null);
      setBlockReason('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось заблокировать'),
  });

  const unblockMut = useMutation({
    mutationFn: () => adminApi.unblockUser(row.id),
    onSuccess: () => {
      toast.success('Пользователь разблокирован');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось разблокировать'),
  });

  const resetMut = useMutation({
    mutationFn: () => adminApi.resetUserPassword(row.id),
    onSuccess: () => {
      toast.success('Письмо со ссылкой для сброса пароля отправлено');
      setModal(null);
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось отправить письмо'),
  });

  const deleteMut = useMutation({
    mutationFn: () => adminApi.deleteUser(row.id),
    onSuccess: () => {
      toast.success('Пользователь удалён');
      setModal(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось удалить'),
  });

  // Для уже удалённых юзеров меню не показываем — действия над удалённым
  // аккаунтом не имеют смысла до того, как он вернётся из soft-delete.
  if (isDeleted) return <span className="text-xs text-muted-foreground">—</span>;

  const makeAdmin = row.role !== 'admin';
  const isBlocked = row.blockedAt !== null;

  const menu =
    open && menuPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
            className="z-50 overflow-hidden rounded-md border border-border bg-card shadow-lg"
          >
            <MenuItem
              disabled={isSelf && !makeAdmin}
              icon={makeAdmin ? Shield : ShieldOff}
              onClick={() => {
                setOpen(false);
                roleMut.mutate(makeAdmin ? 'admin' : 'parent');
              }}
            >
              {makeAdmin ? 'Сделать админом' : 'Забрать права админа'}
            </MenuItem>
            {isBlocked ? (
              <MenuItem
                icon={Unlock}
                onClick={() => {
                  setOpen(false);
                  unblockMut.mutate();
                }}
              >
                Разблокировать
              </MenuItem>
            ) : (
              <MenuItem
                disabled={isSelf}
                icon={Lock}
                onClick={() => {
                  setOpen(false);
                  setModal('block');
                }}
              >
                Заблокировать
              </MenuItem>
            )}
            <MenuItem
              icon={KeyRound}
              onClick={() => {
                setOpen(false);
                setModal('reset');
              }}
            >
              Сбросить пароль
            </MenuItem>
            <MenuItem
              disabled={isSelf}
              danger
              icon={Trash2}
              onClick={() => {
                setOpen(false);
                setModal('delete');
              }}
            >
              Удалить
            </MenuItem>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Действия"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {menu}

      <Dialog open={modal === 'block'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Заблокировать пользователя?</DialogTitle>
            <DialogDescription>
              Пользователь <b>{row.email}</b> не сможет войти в систему до разблокировки. Все
              активные сессии будут завершены.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="block-reason">Причина (необязательно)</Label>
            <Input
              id="block-reason"
              maxLength={300}
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="Напр. подозрительная активность"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={blockMut.isPending}
              onClick={() => blockMut.mutate(blockReason.trim())}
            >
              {blockMut.isPending ? 'Блокируем…' : 'Заблокировать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === 'reset'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сбросить пароль?</DialogTitle>
            <DialogDescription>
              На почту <b>{row.email}</b> придёт письмо со ссылкой для установки нового пароля.
              Ссылка действует 1 час. Сам пароль админу не показывается.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>
              Отмена
            </Button>
            <Button disabled={resetMut.isPending} onClick={() => resetMut.mutate()}>
              {resetMut.isPending ? 'Отправляем…' : 'Отправить письмо'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === 'delete'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить пользователя?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Пользователь <b>{row.email}</b> будет удалён вместе со всеми связанными данными
                (семья, дети, устройства, зоны — если он единственный родитель). Если в семье есть
                другие родители — семья остаётся, один из них становится владельцем.
              </span>
              <span className="block text-red-600">
                Данные удаляются безвозвратно через 30 дней. До этого восстановление возможно через
                БД.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate()}
            >
              {deleteMut.isPending ? 'Удаляем…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MenuItem({
  icon: Icon,
  children,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Shield;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-foreground hover:bg-muted'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{children}</span>
    </button>
  );
}
