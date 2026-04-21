'use client';

import { useState, type ReactElement } from 'react';
import { QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InviteQrDialog } from '@/components/children/invite-qr-dialog';
import { ChildActions } from '@/components/cabinet/child-actions';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import type { Child } from '@/lib/api/children';

interface Props {
  child: Child;
}

export function ChildNotAttachedView({ child }: Props): ReactElement {
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <>
      <div className="flex h-full items-center justify-center bg-zinc-50 p-4 sm:p-6">
        <div className="w-full max-w-[360px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: avatarColor(child.name) }}
            >
              <span className="text-lg font-semibold">{avatarInitial(child.name)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold text-zinc-900">{child.name}</div>
              <div className="truncate text-xs text-zinc-500">устройство не привязано</div>
            </div>
          </div>
          <div className="px-4 py-4 text-sm text-zinc-600">
            <p>
              Установите приложение «GMD для ребёнка» на телефон ребёнка, откройте его и
              отсканируйте QR-код — после этого в кабинете появится карта.
            </p>
            <Button className="mt-4 w-full" onClick={() => setQrOpen(true)}>
              <QrCode className="mr-2 h-4 w-4" />
              Показать QR для привязки
            </Button>
          </div>
          <ChildActions child={child} showReset={false} />
        </div>
      </div>
      <InviteQrDialog child={child} open={qrOpen} onOpenChange={setQrOpen} />
    </>
  );
}
