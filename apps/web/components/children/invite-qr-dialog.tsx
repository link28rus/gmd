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

// Возраст ребёнка в годах по ISO-дате рождения. null если dob не задан.
function computeAgeYears(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export function InviteQrDialog({ child, open, onOpenChange }: Props) {
  const create = useCreateInvite();
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [consentGranted, setConsentGranted] = useState(false);
  const timer = useInviteTimer(expiresAt);

  const age = computeAgeYears(child.dateOfBirth);
  // 14+ с известной датой рождения. Для детей <14 и без даты рождения
  // чекбокс не требуется (backend пропустит claim без consent14Plus).
  const needsConsent = age !== null && age >= 14;

  async function generate() {
    try {
      const r = await create.mutateAsync({
        id: child.id,
        consent14PlusGranted: needsConsent ? consentGranted : false,
      });
      setInvite(r);
      setExpiresAt(Date.now() + r.expiresIn * 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось создать код');
    }
  }

  useEffect(() => {
    if (!open) {
      setInvite(null);
      setExpiresAt(null);
      setConsentGranted(false);
      return;
    }
    // Автогенерация только если согласие не нужно. Иначе ждём чекбокс.
    if (!invite && !needsConsent) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, needsConsent]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Привязка устройства — {child.name}</DialogTitle>
          <DialogDescription>
            Отсканируйте QR на телефоне ребёнка в приложении «Перископ для ребёнка».
          </DialogDescription>
        </DialogHeader>

        {needsConsent && !invite && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="mb-2">
              Ребёнку <strong>{age}</strong> лет. По закону 152-ФЗ для обработки геолокации ребёнка
              14 лет и старше требуется его согласие.
            </p>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={consentGranted}
                onChange={(e) => setConsentGranted(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Я получил согласие ребёнка на обработку его геолокации в сервисе Перископ.
              </span>
            </label>
          </div>
        )}

        <div className="flex flex-col items-center gap-4 py-4">
          {create.isPending && !invite ? (
            <p className="text-sm text-muted-foreground">Генерируем код…</p>
          ) : invite ? (
            <>
              <div className="rounded-md border bg-card p-2">
                <QRCodeSVG value={invite.qrUrl} size={240} includeMargin />
              </div>
              <p className="font-mono text-2xl tracking-widest">{formatCode(invite.code)}</p>
              <p className="text-sm text-muted-foreground">
                {timer.expired ? 'Код истёк' : `Код действителен ${timer.formatted}`}
              </p>
            </>
          ) : needsConsent ? (
            <Button onClick={generate} disabled={!consentGranted || create.isPending}>
              {create.isPending ? 'Генерируем…' : 'Создать код привязки'}
            </Button>
          ) : (
            <p className="text-sm text-red-600">Нет кода</p>
          )}
        </div>
        <DialogFooter>
          {invite && (
            <Button
              variant="outline"
              disabled={create.isPending || (needsConsent && !consentGranted)}
              onClick={generate}
            >
              {create.isPending ? 'Генерируем…' : timer.expired ? 'Обновить код' : 'Новый код'}
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
