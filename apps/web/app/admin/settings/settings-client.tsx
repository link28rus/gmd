'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { adminApi, type AppSettingRow } from '@/lib/api/admin';

export function SettingsClient(): ReactElement {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.listSettings,
  });

  if (q.isPending) {
    return <p className="text-sm text-zinc-500">Загрузка…</p>;
  }
  if (q.error || !q.data) {
    return <p className="text-sm text-red-600">Не удалось загрузить настройки.</p>;
  }

  return (
    <div className="space-y-4">
      {q.data.settings.map((s) => (
        <SettingRow
          key={s.key}
          row={s}
          onSaved={() => qc.invalidateQueries({ queryKey: ['admin', 'settings'] })}
        />
      ))}
    </div>
  );
}

function SettingRow({ row, onSaved }: { row: AppSettingRow; onSaved: () => void }): ReactElement {
  const [value, setValue] = useState(row.value);

  // Если на сервере значение поменялось — подтягиваем.
  useEffect(() => setValue(row.value), [row.value]);

  const m = useMutation({
    mutationFn: (v: string) => adminApi.updateSetting(row.key, v),
    onSuccess: () => {
      toast.success('Сохранено');
      onSaved();
    },
    onError: (e: unknown) => {
      toast.error(`Ошибка: ${e instanceof Error ? e.message : 'не удалось сохранить'}`);
    },
  });

  const dirty = value !== row.value;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between">
        <code className="text-sm font-semibold text-zinc-900">{row.key}</code>
        <span className="text-xs text-zinc-500">
          {new Date(row.updatedAt).toLocaleString('ru')}
          {row.updatedBy ? ` · ${row.updatedBy}` : ''}
        </span>
      </div>
      {row.description && <p className="mb-3 text-sm text-zinc-600">{row.description}</p>}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={!dirty || m.isPending}
          onClick={() => m.mutate(value)}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {m.isPending ? '…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
