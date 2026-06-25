'use client';

import { useState, type ReactElement } from 'react';
import { Lock } from 'lucide-react';
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
import { useCreateBlock } from '@/lib/hooks/use-app-control';
import { ApiError } from '@/lib/api/client';

interface Props {
  childId: string;
  childName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

// Пресеты длительности (минуты): 5 мин для быстрой паузы, до 24 ч для
// «на всю ночь / выходные». Backend принимает любой int в [5, 1440] —
// пресеты лишь для UX.
const PRESETS: Array<{ min: number; label: string }> = [
  { min: 5, label: '5 мин' },
  { min: 15, label: '15 мин' },
  { min: 30, label: '30 мин' },
  { min: 60, label: '1 ч' },
  { min: 120, label: '2 ч' },
  { min: 240, label: '4 ч' },
  { min: 480, label: '8 ч' },
  { min: 1440, label: '24 ч' },
];

function fmtDuration(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

export function BlockDialog({ childId, childName, open, onOpenChange }: Props): ReactElement {
  const [durationMin, setDurationMin] = useState<number>(60);
  const createBlock = useCreateBlock(childId);

  function handleClose(v: boolean): void {
    if (!v) setDurationMin(60); // reset на закрытии
    onOpenChange(v);
  }

  function onConfirm(): void {
    if (createBlock.isPending) return;
    createBlock.mutate(durationMin, {
      onSuccess: () => {
        toast.success(`Блокировка включена на ${fmtDuration(durationMin)}`);
        onOpenChange(false);
      },
      onError: (err: unknown) => {
        // 409 session_already_active — частный кейс: парент уже жал «заблокировать»
        // в другой вкладке/устройстве. Показываем понятный текст.
        if (err instanceof ApiError && err.code === 'session_already_active') {
          toast.error('Блокировка уже включена. Обновите страницу.');
        } else if (err instanceof ApiError && err.code === 'no_active_device') {
          toast.error('У ребёнка нет привязанного устройства');
        } else {
          toast.error(err instanceof Error ? err.message : 'Не удалось включить блокировку');
        }
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Заблокировать приложения</DialogTitle>
          <DialogDescription>
            На устройстве <b>{childName}</b> будут заблокированы все приложения, кроме звонков, SMS,
            камеры и тех, что отмечены в «Не блокируется». Блокировка снимется автоматически через
            выбранное время или вручную кнопкой «Снять блок».
          </DialogDescription>
        </DialogHeader>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">На сколько заблокировать?</p>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.min}
                type="button"
                onClick={() => setDurationMin(p.min)}
                disabled={createBlock.isPending}
                className={
                  'rounded-md border px-3 py-2 text-sm font-medium transition-colors ' +
                  (durationMin === p.min
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-foreground hover:bg-muted')
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleClose(false)}
            disabled={createBlock.isPending}
          >
            Отмена
          </Button>
          <Button onClick={onConfirm} disabled={createBlock.isPending}>
            <Lock className="mr-2 h-4 w-4" />
            {createBlock.isPending ? 'Включаем…' : `Заблокировать на ${fmtDuration(durationMin)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
