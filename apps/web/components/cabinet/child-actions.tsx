'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Bell, Clock, RotateCcw, Shield, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Child } from '@/lib/api/children';
import { ResetDeviceDialog } from '@/components/children/reset-device-dialog';
import { DeleteChildDialog } from '@/components/children/delete-child-dialog';
import { SendSignalDialog } from '@/components/children/send-signal-dialog';
import { useToggleProtection } from '@/lib/hooks/use-children';

interface Props {
  child: Child;
  /** Показывать ли кнопку «Отвязать устройство». */
  showReset: boolean;
}

export function ChildActions({ child, showReset }: Props): ReactElement {
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [signalOpen, setSignalOpen] = useState(false);
  const toggleProtection = useToggleProtection();

  // «Отправить сигнал» и «Защита от удаления» доступны только если
  // устройство привязано.
  const canSignal = showReset;
  const showProtection = showReset;
  const protectionEnabled = child.protectionEnabled;

  const onToggleProtection = (): void => {
    if (toggleProtection.isPending) return;
    const next = !protectionEnabled;
    toggleProtection.mutate(
      { id: child.id, enabled: next },
      {
        onSuccess: () => {
          toast.success(next ? 'Защита от удаления включена' : 'Защита от удаления выключена');
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Не удалось обновить защиту';
          toast.error(msg);
        },
      },
    );
  };

  return (
    <>
      <div className="border-t border-zinc-100">
        <Link
          href={`/cabinet/children/${child.id}/history`}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
        >
          <Clock className="h-4 w-4 text-zinc-500" />
          История передвижений
        </Link>
        {showProtection && (
          <div className="flex w-full items-center justify-between gap-2 border-t border-zinc-100 px-3 py-2 text-sm text-zinc-700">
            <div className="flex items-center gap-2">
              <Shield
                className={`h-4 w-4 ${protectionEnabled ? 'text-emerald-600' : 'text-zinc-500'}`}
                aria-hidden="true"
              />
              <span>Защита от удаления</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={protectionEnabled}
              aria-label={
                protectionEnabled ? 'Выключить защиту от удаления' : 'Включить защиту от удаления'
              }
              onClick={onToggleProtection}
              disabled={toggleProtection.isPending}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${
                protectionEnabled ? 'bg-emerald-600' : 'bg-zinc-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  protectionEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        )}
        {canSignal && (
          <button
            type="button"
            onClick={() => setSignalOpen(true)}
            className="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <Bell className="h-4 w-4 text-zinc-500" />
            Отправить сигнал
          </button>
        )}
        {showReset && (
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            className="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <RotateCcw className="h-4 w-4 text-zinc-500" />
            Отвязать устройство
          </button>
        )}
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 ${
            showReset ? 'border-t border-zinc-100' : ''
          }`}
        >
          <Trash2 className="h-4 w-4" />
          Удалить ребёнка
        </button>
      </div>
      {showReset && (
        <ResetDeviceDialog child={child} open={resetOpen} onOpenChange={setResetOpen} />
      )}
      {canSignal && (
        <SendSignalDialog child={child} open={signalOpen} onOpenChange={setSignalOpen} />
      )}
      <DeleteChildDialog child={child} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}
