// apps/web/app/download/download-public-client.tsx
// Публичный клиент страницы /download. Показывает актуальные версии обоих
// приложений: родителя (gmd-parent) и для телефона ребёнка (gmd-child).
// Список прошлых версий здесь не нужен, они доступны в кабинете.
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

interface AppSection {
  title: string;
  description: string;
  app: 'gmd-parent' | 'gmd-child';
  instructions: string[];
}

const SECTIONS: AppSection[] = [
  {
    title: 'Приложение родителя',
    description:
      'Поставьте на свой телефон, чтобы видеть локацию ребёнка, отправлять сигнал, слушать звук вокруг и получать push-уведомления о геозонах.',
    app: 'gmd-parent',
    instructions: [
      'Скачайте APK на свой телефон (или скиньте файл с ПК).',
      'Откройте APK — Android предложит установить.',
      'Если система блокирует установку, разрешите «Установка из неизвестных источников» для браузера или файлового менеджера.',
      'Войдите по email и паролю — список детей подтянется автоматически.',
    ],
  },
  {
    title: 'Приложение для телефона ребёнка',
    description:
      'Установите на телефон ребёнка и привяжите его QR-кодом из родительского кабинета.',
    app: 'gmd-child',
    instructions: [
      'Скачайте APK на ПК или прямо в браузере телефона ребёнка.',
      'Если скачивали на ПК — перенесите файл на телефон (кабель, Telegram, облако).',
      'Откройте APK-файл на телефоне ребёнка — Android предложит установить.',
      'Если система блокирует установку, включите «Установка из неизвестных источников».',
      'После установки родитель в кабинете создаёт QR-код, ребёнок сканирует его в приложении.',
    ],
  },
];

function pickLatest(
  files: DownloadFile[],
  app: 'gmd-parent' | 'gmd-child',
): {
  version: string | undefined;
  abis: DownloadFile[];
} {
  const byApp = files.filter((f) => f.app === app);
  const version = byApp[0]?.version; // server отсортировал app → version desc → abi
  const abis = byApp.filter((f) => f.version === version);
  return { version, abis };
}

function AppCard({
  section,
  latest,
}: {
  section: AppSection;
  latest: ReturnType<typeof pickLatest>;
}): ReactElement {
  return (
    <section className="mb-8 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-zinc-900">{section.title}</h2>
      <p className="mt-1 mb-5 text-sm text-zinc-600">{section.description}</p>

      {latest.abis.length === 0 ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          Релизов пока нет.
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium text-zinc-900">
              Актуальная версия — v{latest.version}
            </span>
            <span className="text-xs text-zinc-500">
              {new Date(latest.abis[0].uploadedAt).toLocaleString('ru')}
            </span>
          </div>
          <div className="space-y-2">
            {latest.abis.map((f) => (
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
        </>
      )}

      <details className="mt-5 text-sm text-zinc-600">
        <summary className="cursor-pointer font-medium text-zinc-800">Как установить</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {section.instructions.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
    </section>
  );
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
      <h1 className="mb-2 text-3xl font-semibold text-zinc-900">Скачать GMD</h1>
      <p className="mb-8 text-zinc-600">
        Два приложения: одно для своего телефона (родителю), второе — на телефон ребёнка.
      </p>

      {SECTIONS.map((section) => (
        <AppCard key={section.app} section={section} latest={pickLatest(files, section.app)} />
      ))}
    </div>
  );
}
