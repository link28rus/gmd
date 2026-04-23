// apps/web/components/children/child-card.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MapPin, MoreVertical, QrCode, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeviceStatusBadge } from './device-status-badge';
import { EditChildDialog } from './edit-child-dialog';
import { DeleteChildDialog } from './delete-child-dialog';
import { InviteQrDialog } from './invite-qr-dialog';
import { ResetDeviceDialog } from './reset-device-dialog';
import type { Child } from '@/lib/api/children';

interface Props {
  child: Child;
}

function ageYears(dateOfBirth: string | null): string | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--;
  if (years < 0 || years > 30) return null;
  return `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}`;
}

export function ChildCard({ child }: Props) {
  const [menu, setMenu] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const hasActiveDevice = child.device != null && child.device.revokedAt == null;
  const age = ageYears(child.dateOfBirth);

  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{child.name}</h3>
          {age && <p className="text-sm text-muted-foreground">{age}</p>}
          <div className="mt-2">
            <DeviceStatusBadge device={child.device} />
          </div>
        </div>
        <div className="relative">
          <Button variant="ghost" size="icon" onClick={() => setMenu((v) => !v)} aria-label="Меню">
            <MoreVertical className="h-4 w-4" />
          </Button>
          {menu && (
            <div
              className="absolute right-0 top-full z-10 mt-1 w-40 rounded-md border border-border bg-card shadow-md"
              onMouseLeave={() => setMenu(false)}
            >
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setMenu(false);
                  setEditOpen(true);
                }}
              >
                Редактировать
              </button>
              <button
                className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                onClick={() => {
                  setMenu(false);
                  setDeleteOpen(true);
                }}
              >
                Удалить
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => setInviteOpen(true)}
          disabled={hasActiveDevice}
        >
          <QrCode className="h-4 w-4 mr-1" />
          QR для привязки
        </Button>
        {hasActiveDevice && (
          <Link
            href={`/cabinet/children/${child.id}/map`}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            <MapPin className="h-4 w-4" />
            На карту
          </Link>
        )}
        {hasActiveDevice && (
          <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Сбросить устройство
          </Button>
        )}
      </div>
      <EditChildDialog child={child} open={editOpen} onOpenChange={setEditOpen} />
      <DeleteChildDialog child={child} open={deleteOpen} onOpenChange={setDeleteOpen} />
      <InviteQrDialog child={child} open={inviteOpen} onOpenChange={setInviteOpen} />
      <ResetDeviceDialog child={child} open={resetOpen} onOpenChange={setResetOpen} />
    </article>
  );
}
