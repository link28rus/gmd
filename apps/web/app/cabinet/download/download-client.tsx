// apps/web/app/cabinet/download/download-client.tsx
'use client';

import { useEffect, useState, type ReactElement } from 'react';

interface DownloadFile {
  filename: string;
  app: 'gmd-child' | 'gmd-parent';
  version: string;
  abi: string;
  size: number;
  uploadedAt: string;
}

interface Grouped {
  app: 'gmd-child' | 'gmd-parent';
  version: string;
  files: DownloadFile[]; // разные ABI одной версии
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

function abiHint(abi: string): string {
  if (abi === 'arm64-v8a') return 'Для большинства телефонов (рекомендуется)';
  if (abi === 'armeabi-v7a') return 'Для старых устройств 32-bit';
  if (abi === 'x86_64') return 'Для эмуляторов x86_64';
  return '';
}

function appTitle(app: DownloadFile['app']): string {
  return app === 'gmd-child' ? 'Приложение ребёнка' : 'Приложение родителя';
}

export default function DownloadClient(): ReactElement {
  const [files, setFiles] = useState<DownloadFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/download', { cache: 'no-store', credentials: 'include' })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { files: DownloadFile[] };
        setFiles(body.files ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false));
  }, []);

  // Группировка: app + version → список abi
  const grouped: Grouped[] = [];
  for (const f of files) {
    const key = grouped.find((g) => g.app === f.app && g.version === f.version);
    if (key) key.files.push(f);
    else grouped.push({ app: f.app, version: f.version, files: [f] });
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8 text-sm text-muted-foreground">Загрузка…</div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Не удалось загрузить список релизов: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-2 text-2xl font-semibold text-foreground">Приложение ребёнка</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Скачайте APK-файл и установите его на телефон ребёнка. Разрешите установку из неизвестных
        источников, если Android попросит.
      </p>

      {grouped.length === 0 && (
        <div className="rounded-md border border-border bg-muted p-6 text-sm text-muted-foreground">
          Релизов пока нет.
        </div>
      )}

      {grouped.map((g) => (
        <section key={`${g.app}-${g.version}`} className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg font-medium text-foreground">
              {appTitle(g.app)} — v{g.version}
            </h2>
            <span className="text-xs text-muted-foreground">
              {new Date(g.files[0].uploadedAt).toLocaleString('ru')}
            </span>
          </div>
          <div className="space-y-2">
            {g.files.map((f) => (
              <a
                key={f.filename}
                href={`/api/download/${encodeURIComponent(f.filename)}`}
                className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 hover:border-zinc-400 hover:bg-muted"
              >
                <div>
                  <div className="font-medium text-foreground">
                    {f.abi}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {formatBytes(f.size)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{abiHint(f.abi)}</div>
                </div>
                <span className="text-sm font-medium text-blue-600">Скачать</span>
              </a>
            ))}
          </div>
        </section>
      ))}

      <div className="mt-8 rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">Как установить на телефон ребёнка</div>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Скачайте APK на ПК или в браузере телефона.</li>
          <li>Перенесите файл на телефон (кабель, Telegram, облако).</li>
          <li>Откройте файл на телефоне — Android предложит установить.</li>
          <li>
            Если система блокирует установку — включите «Установка из неизвестных источников» для
            использованного браузера/файлового менеджера.
          </li>
        </ol>
      </div>
    </div>
  );
}
