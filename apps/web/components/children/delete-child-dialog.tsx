// apps/web/components/children/delete-child-dialog.tsx
'use client';

import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeleteChild } from '@/lib/hooks/use-children';
import type { Child } from '@/lib/api/children';

interface Props {
  child: Child;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function DeleteChildDialog({ child, open, onOpenChange }: Props) {
  const [typed, setTyped] = useState('');
  const remove = useDeleteChild();
  const matches = typed.trim() === child.name;

  async function onConfirm() {
    try {
      await remove.mutateAsync(child.id);
      toast.success('Ребёнок удалён');
      onOpenChange(false);
      setTyped('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось удалить');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTyped('');
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить ребёнка?</DialogTitle>
          <DialogDescription>
            Устройство будет отвязано, все инвайты станут недействительны. Действие нельзя отменить.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirm-name">
            Введите имя <b>{child.name}</b> для подтверждения:
          </Label>
          <Input
            id="confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button variant="destructive" disabled={!matches || remove.isPending} onClick={onConfirm}>
            {remove.isPending ? 'Удаляем…' : 'Удалить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
