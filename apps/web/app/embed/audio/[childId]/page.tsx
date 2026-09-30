'use client';

import { use, useEffect, useState, type ReactElement } from 'react';
import { AudioSessionPane } from '@/components/children/audio-listen-dialog';
import { childrenApi, type Child } from '@/lib/api/children';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Embed-страница «Звук вокруг ребёнка», предназначенная для открытия в
 * WebView mobile-parent (Flutter, см. apps/mobile-parent/lib/features/audio).
 *
 * URL: `/embed/audio/<childId>#t=<accessToken>&n=<encodedURIComponent name>&f=<familyId>&fn=<familyName>&u=<userId>&e=<email>[&m=<0|1>]`.
 *
 * `m` (опц., v0.62.0) — `device.micReady` из списка детей mobile-parent. Кроме того
 * страница сама подтягивает свежий `GET /api/children` и берёт оттуда `device`
 * ребёнка — так предупреждение «микрофон выключен» работает и в уже установленных
 * mobile-parent, которые `m` не передают.
 *
 * Hash, а не query — чтобы access-token не попадал в access-логи nginx/Caddy
 * и не уезжал в backend в Referer (хеш не передаётся в HTTP-запросах).
 *
 * При mount парсим hash → кладём в `useAuthStore`, и audio-pane сразу делает
 * запросы через `apiFetch` (он берёт accessToken из store). Refresh через
 * cookie у WebView нет — access-token живёт 15 мин, audio-сессия 5. Поэтому
 * mobile-parent обязан передавать свежий токен (`AuthRepository.freshAccessToken`,
 * v0.68.2): протухший давал 401 на `POST /audio/sessions` → «Ошибка соединения».
 */
export default function AudioEmbedPage({
  params,
}: {
  params: Promise<{ childId: string }>;
}): ReactElement {
  const { childId } = use(params);
  const [child, setChild] = useState<Child | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get('t');
    const name = params.get('n');
    const familyId = params.get('f');
    const familyName = params.get('fn');
    const userId = params.get('u');
    const email = params.get('e');
    const micParam = params.get('m');
    const micReady = micParam === '1' ? true : micParam === '0' ? false : null;

    if (!token || !name) {
      setError('Не передан токен авторизации или имя ребёнка.');
      return;
    }

    // Минимально необходимые поля User/Family для apiFetch / consent-checks.
    if (familyId && familyName && userId && email) {
      useAuthStore.getState().setAll({
        accessToken: token,
        user: { id: userId, email, name: null, locale: 'ru' },
        family: { id: familyId, name: familyName },
      });
    } else {
      useAuthStore.getState().setAccess(token);
    }
    // Минимальный stub Child — AudioSessionPane использует id, name и
    // device.micReady. Остальные поля ему не нужны, но Type Child требует их.
    setChild({
      id: childId,
      name,
      dateOfBirth: null,
      protectionEnabled: false,
      protectionEnabledAt: null,
      avatarKey: null,
      device:
        micReady === null
          ? null
          : {
              id: '',
              deviceName: null,
              osVersion: null,
              appVersion: null,
              lastSeenAt: null,
              revokedAt: null,
              micReady,
            },
    });

    // Свежий статус устройства (micReady) — best-effort: ошибка не мешает
    // audio-сессии, остаётся значение из hash.
    let cancelled = false;
    childrenApi
      .list()
      .then(({ children }) => {
        const fresh = children.find((c) => c.id === childId);
        if (cancelled || !fresh?.device) return;
        const device = fresh.device;
        setChild((prev) => (prev ? { ...prev, device } : prev));
      })
      .catch(() => {
        /* нет сети / токен истёк — предупреждение просто не обновится */
      });

    // Чистим hash из адресной строки чтобы токен не светился в случае
    // если родитель откроет devtools (и в reload состоянии).
    if (window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    return () => {
      cancelled = true;
    };
  }, [childId]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!child) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Подключаемся…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <AudioSessionPane child={child} onOpenChange={handleClose} />
    </div>
  );
}

/**
 * Когда AudioSessionPane вызывает onOpenChange(false) (кнопка «Закрыть» /
 * «Остановить»), просим хост-приложение (Flutter WebView) закрыть экран
 * через JS-bridge PeriscopHost.postMessage. В web-режиме (вне WebView) канала
 * нет — fallback пытается просто history.back().
 */
function handleClose(open: boolean): void {
  if (open) return;
  // PeriscopHost — имя канала в mobile-parent после ребрендинга; GmdHost — в старых сборках.
  const w = window as unknown as Record<string, { postMessage?: (m: string) => void } | undefined>;
  const host = w.PeriscopHost ?? w.GmdHost;
  if (host?.postMessage) {
    host.postMessage('close');
  } else if (window.history.length > 1) {
    window.history.back();
  }
}
