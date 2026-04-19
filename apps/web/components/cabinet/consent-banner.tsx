'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';

interface ConsentBannerProps {
  requiresConsent: boolean;
}

export function ConsentBanner({ requiresConsent }: ConsentBannerProps): React.ReactElement | null {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [loading, setLoading] = useState(false);

  if (!requiresConsent) return null;

  async function handleAccept(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch('/api/me/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ documents: ['PRIVACY_POLICY', 'TERMS_OF_USE'] }),
      });

      if (res.status === 204 || res.status === 200) {
        await queryClient.invalidateQueries({ queryKey: ['me'] });
        router.refresh();
        window.location.reload();
        return;
      }

      if (res.status === 400) {
        const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        if (json?.error?.code === 'consent_already_accepted') {
          router.refresh();
          window.location.reload();
          return;
        }
      }

      toast.error('Не удалось подтвердить согласие. Попробуйте ещё раз.');
    } catch {
      toast.error('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-3">
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-amber-900">
          <span className="mr-1 font-semibold">Политика конфиденциальности обновлена.</span>
          Чтобы продолжить пользоваться GMD, прочитайте{' '}
          <Link href="/privacy" className="underline hover:no-underline">
            новую версию
          </Link>{' '}
          и подтвердите согласие.
        </p>
        <button
          onClick={handleAccept}
          disabled={loading}
          className="shrink-0 rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {loading ? 'Сохраняем…' : 'Прочитал и согласен'}
        </button>
      </div>
    </div>
  );
}
