// apps/web/app/download/download-public-client.tsx
// Публичный клиент страницы /download. Показывает актуальные версии обоих
// приложений: родителя (gmd-parent) и для телефона ребёнка (gmd-child).
// Список прошлых версий здесь не нужен, они доступны в кабинете.
'use client';

import Image from 'next/image';
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

// С 2026-09-27 приложения ставятся из APK с этого сервера: версии в RuStore
// собраны под прежний домен и с текущим сервером не работают.
interface AppSection {
  title: string;
  description: string;
  app: 'gmd-parent' | 'gmd-child';
  icon: string;
  instructions: string[];
}

const SECTIONS: AppSection[] = [
  {
    title: 'Приложение родителя',
    description:
      'Поставьте на свой телефон, чтобы видеть локацию ребёнка, отправлять сигнал, слушать звук вокруг и получать уведомления о геозонах.',
    app: 'gmd-parent',
    icon: '/app-icon-parent.png',
    instructions: [
      'Скачайте файл arm64-v8a — он подходит почти всем телефонам.',
      'Откройте скачанный файл. Если телефон спросит — разрешите браузеру устанавливать приложения.',
      'Запустите приложение и войдите по email и паролю — список детей подтянется автоматически.',
    ],
  },
  {
    title: 'Приложение для телефона ребёнка',
    description:
      'Установите на телефон ребёнка и привяжите его кодом или QR-кодом из кабинета родителя.',
    app: 'gmd-child',
    icon: '/app-icon-child.png',
    instructions: [
      'Откройте эту страницу на телефоне ребёнка и скачайте файл arm64-v8a.',
      'Откройте скачанный файл и разрешите установку из этого источника.',
      'Запустите приложение, выдайте запрошенные разрешения и введите код из кабинета родителя.',
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
  // arm64-v8a — первым: он нужен почти всем.
  const abis = [...latest.abis].sort(
    (a, b) => Number(b.abi === 'arm64-v8a') - Number(a.abi === 'arm64-v8a'),
  );
  return (
    <section className="mb-8 rounded-lg border border-slate-700/60 bg-slate-900/70 p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <Image
          src={section.icon}
          alt={`Иконка «${section.title}»`}
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-xl shadow-sm"
        />
        <h2 className="text-xl font-semibold text-white">{section.title}</h2>
      </div>
      <p className="mt-2 mb-5 text-sm text-slate-300">{section.description}</p>

      {abis.length === 0 ? (
        <div className="rounded-md border border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-400">
          Файл приложения пока не выложен.
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-white">
              Актуальная версия — v{latest.version?.split('+')[0]}
            </span>
            <span className="text-xs text-slate-400">
              {new Date(abis[0].uploadedAt).toLocaleString('ru')}
            </span>
          </div>
          <div className="space-y-2">
            {abis.map((f) => {
              const primary = f.abi === 'arm64-v8a';
              return (
                <a
                  key={f.filename}
                  href={`/api/public/download/${encodeURIComponent(f.filename)}`}
                  className={
                    primary
                      ? 'flex items-center justify-between rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-3 transition hover:border-sky-400/60 hover:bg-sky-500/20'
                      : 'flex items-center justify-between rounded-md border border-slate-700 bg-slate-950/40 px-4 py-3 transition hover:border-slate-500 hover:bg-slate-900'
                  }
                >
                  <div>
                    <div className="font-medium text-slate-100">
                      {f.abi}
                      <span className="ml-2 text-sm font-normal text-slate-400">
                        {formatBytes(f.size)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">{abiHint(f.abi)}</div>
                  </div>
                  <span className="text-sm font-medium text-sky-300">Скачать</span>
                </a>
              );
            })}
          </div>
        </>
      )}

      <details className="mt-4 text-sm text-slate-300">
        <summary className="cursor-pointer font-medium text-slate-200">Как установить</summary>
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
    return <div className="mx-auto max-w-3xl px-6 py-8 text-sm text-slate-400">Загрузка…</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          Не удалось загрузить список релизов: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-3xl font-semibold text-white">Скачать Перископ</h1>
      <p className="mb-3 text-slate-300">
        Два приложения для Android: одно для своего телефона (родителю), второе — на телефон
        ребёнка. Новая версия ставится так же, поверх старой — данные сохраняются.
      </p>
      <p className="mb-8 text-sm text-slate-400">
        Если телефон предупредит, что приложение неизвестное или небезопасное, нажмите «Подробнее» и
        «Всё равно установить».
      </p>

      {SECTIONS.map((section) => (
        <AppCard key={section.app} section={section} latest={pickLatest(files, section.app)} />
      ))}
    </div>
  );
}
