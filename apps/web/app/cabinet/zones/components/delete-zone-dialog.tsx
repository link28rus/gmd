// apps/web/app/cabinet/zones/components/delete-zone-dialog.tsx
'use client';

import type { ReactElement } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeleteZone } from '@/lib/hooks/use-zones';
import { zoneErrorMessage, type Zone } from '@/lib/api/zones';

interface Props {
  open: boolean;
  zone: Zone | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (zoneId: string) => void;
}

export function DeleteZoneDialog({ open, zone, onOpenChange, onDeleted }: Props): ReactElement {
  const remove = useDeleteZone();

  async function onConfirm(): Promise<void> {
    if (!zone) return;
    try {
      await remove.mutateAsync(zone.id);
      toast.success('Зона удалена');
      onDeleted(zone.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(zoneErrorMessage(e, 'delete'));
    }
  }

  return (
    <Dialog open={open && zone !== null} onOpenChange={(v) => !remove.isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить зону «{zone?.name}»?</DialogTitle>
          <DialogDescription>
            Уведомления о входе и выходе по этой зоне прекратятся, её события исчезнут из ленты.
            Действие нельзя отменить.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={remove.isPending}>
            Отмена
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={remove.isPending}>
            {remove.isPending ? 'Удаляем…' : 'Удалить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
