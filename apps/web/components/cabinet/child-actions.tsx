'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Clock, RotateCcw, Trash2 } from 'lucide-react';
import type { Child } from '@/lib/api/children';
import { ResetDeviceDialog } from '@/components/children/reset-device-dialog';
import { DeleteChildDialog } from '@/components/children/delete-child-dialog';

interface Props {
  child: Child;
  /** Показывать ли кнопку «Отвязать устройство». */
  showReset: boolean;
}

export function ChildActions({ child, showReset }: Props): ReactElement {
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
      <DeleteChildDialog child={child} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}
