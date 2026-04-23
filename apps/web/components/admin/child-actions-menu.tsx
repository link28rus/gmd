'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement } from 'react';
import { MoreVertical, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, type AdminChildRow } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type ModalKind = 'delete' | 'reset' | null;

interface Props {
  row: AdminChildRow;
}

export function ChildActionsMenu({ row }: Props): ReactElement | null {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_WIDTH = 224;

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const reposition = (): void => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - MENU_WIDTH) });
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

  const isDeleted = row.deletedAt !== null;
  const hasActiveDevice = row.deviceStatus === 'online' || row.deviceStatus === 'offline';

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ['admin', 'children'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'families'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
  }

  const deleteMut = useMutation({
    mutationFn: () => adminApi.deleteChild(row.id),
    onSuccess: () => {
      toast.success('Ребёнок удалён');
      setModal(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось удалить'),
  });

  const resetMut = useMutation({
    mutationFn: () => adminApi.resetChildDevice(row.id),
    onSuccess: () => {
      toast.success('Устройство ребёнка отозвано');
      setModal(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось отозвать устройство'),
  });

  if (isDeleted) return <span className="text-xs text-muted-foreground">—</span>;

  const menu =
    open && menuPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
            className="z-50 overflow-hidden rounded-md border border-border bg-card shadow-lg"
          >
            <button
              type="button"
              disabled={!hasActiveDevice}
              onClick={() => {
                setOpen(false);
                setModal('reset');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Отозвать устройство</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setModal('delete');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              <span>Удалить ребёнка</span>
            </button>
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

      <Dialog open={modal === 'reset'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отозвать устройство?</DialogTitle>
            <DialogDescription>
              Устройство ребёнка <b>{row.name}</b> перестанет отправлять локации. Чтобы снова
              подключить — создайте новый QR-invite в семье.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={resetMut.isPending}
              onClick={() => resetMut.mutate()}
            >
              {resetMut.isPending ? 'Отзываем…' : 'Отозвать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === 'delete'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить ребёнка?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Ребёнок <b>{row.name}</b> будет помечен удалённым. Устройство отзовётся, активные
                QR-коды станут недействительны.
              </span>
              <span className="block text-red-600">
                Данные удаляются безвозвратно через 30 дней.
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
