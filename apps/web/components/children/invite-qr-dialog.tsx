// apps/web/components/children/invite-qr-dialog.tsx
'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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
import { useCreateInvite } from '@/lib/hooks/use-children';
import { useInviteTimer } from '@/lib/hooks/use-invite-timer';
import type { Child, InviteResponse } from '@/lib/api/children';

interface Props {
  child: Child;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function formatCode(code: string): string {
  return code.match(/.{1,2}/g)?.join(' ') ?? code;
}

export function InviteQrDialog({ child, open, onOpenChange }: Props) {
  const create = useCreateInvite();
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const timer = useInviteTimer(expiresAt);

  async function generate() {
    try {
      const r = await create.mutateAsync(child.id);
      setInvite(r);
      setExpiresAt(Date.now() + r.expiresIn * 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось создать код');
    }
  }

  useEffect(() => {
    if (open && !invite) void generate();
    if (!open) {
      setInvite(null);
      setExpiresAt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Привязка устройства — {child.name}</DialogTitle>
          <DialogDescription>
            Отсканируйте QR на телефоне ребёнка в приложении «GMD для ребёнка».
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {create.isPending && !invite ? (
            <p className="text-sm text-zinc-500">Генерируем код…</p>
          ) : invite ? (
            <>
              <div className="p-2 bg-white border rounded-md">
                <QRCodeSVG value={invite.qrUrl} size={240} includeMargin />
              </div>
              <p className="font-mono text-2xl tracking-widest">{formatCode(invite.code)}</p>
              <p className="text-sm text-zinc-500">
                {timer.expired ? 'Код истёк' : `Код действителен ${timer.formatted}`}
              </p>
            </>
          ) : (
            <p className="text-sm text-red-600">Нет кода</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={create.isPending} onClick={generate}>
            {create.isPending ? 'Генерируем…' : timer.expired ? 'Обновить код' : 'Новый код'}
          </Button>
          <Button onClick={() => onOpenChange(false)}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
