'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { permissionStateApi } from '@/lib/api/permission-state';

export function PermissionStateCard({ childId }: { childId: string }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { data, isError } = useQuery({
    queryKey: ['permission-state', childId],
    queryFn: () => permissionStateApi.get(childId),
    refetchInterval: 15_000,
  });
  const title = isError
    ? 'Не удалось проверить разрешения'
    : !data
      ? 'Проверяем разрешения…'
      : data.status === 'unknown'
        ? data.reportedAt
          ? 'Не все разрешения удалось проверить'
          : 'Нет отчёта о разрешениях'
        : data.status === 'stale'
          ? 'Данные устарели — состояние неизвестно'
          : data.status === 'degraded'
            ? 'Требуется восстановить разрешения'
            : 'Разрешения в порядке';

  async function refresh() {
    setBusy(true);
    setMessage('');
    try {
      const result = await permissionStateApi.refresh(childId);
      setMessage(
        result.requested
          ? 'Запрос отправлен. Ожидаем отчёт телефона.'
          : 'Телефон недоступен. Отчёт появится после выхода на связь.',
      );
      await client.invalidateQueries({ queryKey: ['permission-state', childId] });
    } catch {
      setMessage('Не удалось отправить запрос. Повторите позже.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-3 rounded-md border border-border p-3 text-sm"
      aria-label="Состояние разрешений"
    >
      <p className="font-medium">{title}</p>
      {data && data.missing.length > 0 && (
        <p className="mt-1 text-amber-700 dark:text-amber-400">
          {data.status === 'stale' ? 'В последнем отчёте отключено: ' : 'Отключено: '}
          {data.missing.map((p) => p.label).join(', ')}
        </p>
      )}
      {data?.reportedAt && (
        <p className="mt-1 text-xs text-muted-foreground">
          Проверено: {new Date(data.reportedAt).toLocaleString('ru-RU')}
        </p>
      )}
      {data?.status === 'unknown' && (
        <p className="mt-1 text-xs text-muted-foreground">
          Откройте обновлённое приложение на телефоне ребёнка.
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={refresh}
        className="mt-2 underline disabled:opacity-50"
      >
        {busy ? 'Отправляем…' : 'Проверить сейчас'}
      </button>
      {message && (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
