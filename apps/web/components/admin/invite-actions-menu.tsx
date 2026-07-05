'use client';

import { useState } from 'react';
import type { ReactElement } from 'react';
import { Ban } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, type InviteRow } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function InviteActionsMenu({ row }: { row: InviteRow }): ReactElement {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const revokeMut = useMutation({
    mutationFn: () => adminApi.revokeInvite(row.id),
    onSuccess: () => {
      toast.success('Инвайт отозван');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['admin', 'invites'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось отозвать'),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Отозвать инвайт"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
      >
        <Ban className="h-3.5 w-3.5" />
        Отозвать
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отозвать инвайт?</DialogTitle>
            <DialogDescription>
              QR-код <b>{row.code}</b> (ребёнок {row.childName || '—'}, семья{' '}
              {row.familyName || '—'}) станет недействительным. Подключить устройство по нему будет
              нельзя — родитель сможет создать новый.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={revokeMut.isPending}
              onClick={() => revokeMut.mutate()}
            >
              {revokeMut.isPending ? 'Отзываем…' : 'Отозвать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
