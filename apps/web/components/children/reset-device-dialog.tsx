// apps/web/components/children/reset-device-dialog.tsx
'use client';

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
import { useResetDevice } from '@/lib/hooks/use-children';
import type { Child } from '@/lib/api/children';

interface Props {
  child: Child;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ResetDeviceDialog({ child, open, onOpenChange }: Props) {
  const reset = useResetDevice();

  async function onConfirm() {
    try {
      await reset.mutateAsync(child.id);
      toast.success('Устройство отозвано');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось отозвать');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Сбросить устройство?</DialogTitle>
          <DialogDescription>
            Телефон <b>{child.name}</b> перестанет передавать данные. Нужно будет привязать
            устройство заново через новый QR.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={reset.isPending}>
            {reset.isPending ? 'Сбрасываем…' : 'Сбросить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
