'use client';

import { useState, type ReactElement } from 'react';
import { QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InviteQrDialog } from '@/components/children/invite-qr-dialog';
import { ChildActions } from '@/components/cabinet/child-actions';
import { ChildAvatar } from '@/components/avatar/child-avatar';
import { ChildAvatarDialog } from '@/components/children/child-avatar-dialog';
import type { Child } from '@/lib/api/children';

interface Props {
  child: Child;
}

export function ChildNotAttachedView({ child }: Props): ReactElement {
  const [qrOpen, setQrOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  return (
    <>
      <div className="flex h-full items-center justify-center bg-muted p-4 sm:p-6">
        <div className="w-full max-w-[360px] overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setAvatarOpen(true)}
              aria-label="Фото профиля"
              title="Фото профиля"
              className="shrink-0 rounded-full transition hover:opacity-80"
            >
              <ChildAvatar
                name={child.name}
                avatarKey={child.avatarKey}
                childId={child.id}
                size={48}
              />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold text-foreground">{child.name}</div>
              <div className="truncate text-xs text-muted-foreground">устройство не привязано</div>
            </div>
          </div>
          <div className="px-4 py-4 text-sm text-muted-foreground">
            <p>
              Установите приложение «Перископ для ребёнка» на телефон ребёнка, откройте его и
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
      <ChildAvatarDialog child={child} open={avatarOpen} onOpenChange={setAvatarOpen} />
    </>
  );
}
