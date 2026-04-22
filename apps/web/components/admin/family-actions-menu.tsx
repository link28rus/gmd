'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement } from 'react';
import { MoreVertical, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, type FamilyRow } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  row: FamilyRow;
}

export function FamilyActionsMenu({ row }: Props): ReactElement | null {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'delete' | null>(null);
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

  const deleteMut = useMutation({
    mutationFn: () => adminApi.deleteFamily(row.id),
    onSuccess: () => {
      toast.success('Семья удалена');
      setModal(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'families'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'children'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось удалить'),
  });

  if (isDeleted) return <span className="text-xs text-zinc-400">—</span>;

  const menu =
    open && menuPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
            className="z-50 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg"
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setModal('delete');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              <span>Удалить семью</span>
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
        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {menu}

      <Dialog open={modal === 'delete'} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить семью?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Семья <b>{row.name}</b> и все её дети будут помечены удалёнными. Устройства детей
                отзовутся, активные QR-коды станут недействительны. Сам аккаунт-owner остаётся.
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
