'use client';

import { use, useEffect, useState, type ReactElement } from 'react';
import AppControlDisabled from '@/app/cabinet/children/[id]/parental-control/app-control-disabled';
import ParentalControlClient from '@/app/cabinet/children/[id]/parental-control/parental-control-client';
import { useAuthStore } from '@/lib/auth-store';
import { APP_CONTROL_ENABLED } from '@/lib/features';

/**
 * Embed-страница «Родительский контроль», предназначенная для открытия
 * в WebView mobile-parent (Flutter, см.
 * `apps/mobile-parent/lib/features/parental_control/parental_control_screen.dart`).
 *
 * URL: `/embed/parental-control/<childId>#t=<accessToken>&u=<userId>&e=<email>&f=<familyId>&fn=<familyName>`.
 *
 * Hash, а не query — чтобы access-token не уезжал в access-логи Caddy и в
 * Referer (хеш в HTTP-запросах не передаётся). При mount парсим hash → кладём
 * в `useAuthStore`, и `apiFetch` сразу делает запросы. Затем чистим hash из
 * адресной строки `history.replaceState`.
 */
export default function ParentalControlEmbedPage({
  params,
}: {
  params: Promise<{ childId: string }>;
}): ReactElement {
  const { childId } = use(params);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get('t');
    const userId = params.get('u');
    const email = params.get('e');
    const familyId = params.get('f');
    const familyName = params.get('fn');

    if (!token) {
      setError('Не передан токен авторизации.');
      return;
    }

    // ParentalControlClient использует useChildren() → GET /family/children,
    // который требует family.id в auth-store. Без него apiFetch не работает.
    if (familyId && familyName && userId && email) {
      useAuthStore.getState().setAll({
        accessToken: token,
        user: { id: userId, email, name: null, locale: 'ru' },
        family: { id: familyId, name: familyName },
      });
    } else {
      useAuthStore.getState().setAccess(token);
    }

    if (window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    setReady(true);
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Подключаемся…</p>
      </div>
    );
  }

  // v0.58.0: функция временно отключена — старые версии mobile-parent
  // всё ещё открывают этот экран из меню ребёнка, показываем заглушку.
  if (!APP_CONTROL_ENABLED) return <AppControlDisabled onBack={handleClose} />;
  return <ParentalControlClient childId={childId} onBack={handleClose} />;
}

/**
 * Кнопка «Назад» в embed-режиме просит хост-приложение (Flutter WebView)
 * закрыть экран через JS-bridge PeriscopHost.postMessage. В обычном браузере
 * (вне WebView) канала нет — fallback на history.back().
 */
function handleClose(): void {
  // PeriscopHost — имя канала в mobile-parent после ребрендинга; GmdHost — в старых сборках.
  const w = window as unknown as Record<string, { postMessage?: (m: string) => void } | undefined>;
  const host = w.PeriscopHost ?? w.GmdHost;
  if (host?.postMessage) {
    host.postMessage('close');
  } else if (window.history.length > 1) {
    window.history.back();
  }
}
