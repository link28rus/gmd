'use client';

import { useState, type ReactElement } from 'react';
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
import { childrenApi } from '@/lib/api/children';
import type { Child } from '@/lib/api/children';

interface Props {
  child: Child;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function SendSignalDialog({ child, open, onOpenChange }: Props): ReactElement {
  const [sending, setSending] = useState(false);

  async function onConfirm(): Promise<void> {
    setSending(true);
    try {
      await childrenApi.sendSignal(child.id);
      toast.success(
        'Сигнал отправлен — прозвучит на телефоне ребёнка в течение 2 минут, даже если звук выключен',
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось отправить сигнал');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отправить сигнал?</DialogTitle>
          <DialogDescription>
            На телефоне <b>{child.name}</b> прозвучит громкий сигнал в течение 2 минут — даже если
            звук убавлен или выключен (используется канал будильника). Сигнал остановится сам через
            минуту.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            Отмена
          </Button>
          <Button onClick={onConfirm} disabled={sending}>
            {sending ? 'Отправляем…' : 'Отправить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
