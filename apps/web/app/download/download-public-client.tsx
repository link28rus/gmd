// apps/web/app/download/download-public-client.tsx
// Публичный клиент страницы /download. Показывает только АКТУАЛЬНУЮ версию
// приложения ребёнка (gmd-child) — без залогинивания. Список прошлых версий
// здесь не нужен, они доступны в кабинете.
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

export default function DownloadPublicClient(): ReactElement {
  const [files, setFiles] = useState<DownloadFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/public/download', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { files: DownloadFile[] };
        setFiles(body.files ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false));
  }, []);

  // Оставляем только последнюю версию приложения ребёнка. Файлы уже отсортированы
  // на сервере (app → version desc → abi).
  const childFiles = files.filter((f) => f.app === 'gmd-child');
  const latestVersion = childFiles[0]?.version;
  const latestFiles = childFiles.filter((f) => f.version === latestVersion);

  if (loading) {
    return <div className="mx-auto max-w-3xl px-6 py-8 text-sm text-zinc-500">Загрузка…</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Не удалось загрузить список релизов: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-3xl font-semibold text-zinc-900">Приложение для телефона ребёнка</h1>
      <p className="mb-8 text-zinc-600">
        Скачайте APK-файл на телефон ребёнка и установите. Разрешите установку из неизвестных
        источников, если Android попросит.
      </p>

      {latestFiles.length === 0 ? (
        <div className="rounded-md border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          Релизов пока нет.
        </div>
      ) : (
        <section className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-medium text-zinc-900">
              Актуальная версия — v{latestVersion}
            </h2>
            <span className="text-xs text-zinc-500">
              {new Date(latestFiles[0].uploadedAt).toLocaleString('ru')}
            </span>
          </div>
          <div className="space-y-2">
            {latestFiles.map((f) => (
              <a
                key={f.filename}
                href={`/api/public/download/${encodeURIComponent(f.filename)}`}
                className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-400 hover:bg-zinc-50"
              >
                <div>
                  <div className="font-medium text-zinc-900">
                    {f.abi}
                    <span className="ml-2 text-sm font-normal text-zinc-500">
                      {formatBytes(f.size)}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">{abiHint(f.abi)}</div>
                </div>
                <span className="text-sm font-medium text-blue-600">Скачать</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
        <div className="mb-2 font-medium text-zinc-800">Как установить на телефон ребёнка</div>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Скачайте APK на ПК или прямо в браузере телефона.</li>
          <li>Если скачивали на ПК — перенесите файл на телефон (кабель, Telegram, облако).</li>
          <li>Откройте APK-файл на телефоне — Android предложит установить.</li>
          <li>
            Если система блокирует установку, включите «Установка из неизвестных источников» для
            браузера или файлового менеджера.
          </li>
          <li>После установки попросите родителя войти в кабинет и создать QR-код для привязки.</li>
        </ol>
      </div>
    </div>
  );
}
