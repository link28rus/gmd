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

interface AppSection {
  title: string;
  description: string;
  app: 'gmd-parent' | 'gmd-child';
  icon: string;
  rustoreUrl: string;
  instructions: string[];
}

const SECTIONS: AppSection[] = [
  {
    title: 'Приложение родителя',
    description:
      'Поставьте на свой телефон, чтобы видеть локацию ребёнка, отправлять сигнал, слушать звук вокруг и получать push-уведомления о геозонах.',
    app: 'gmd-parent',
    icon: '/app-icon-parent.png',
    rustoreUrl: 'https://www.rustore.ru/catalog/app/pro.periscop.parent',
    instructions: [
      'Откройте страницу «Перископ Родителя» в RuStore и нажмите «Установить».',
      'Дождитесь установки и запустите приложение.',
      'Войдите по email и паролю — список детей подтянется автоматически.',
    ],
  },
  {
    title: 'Приложение для телефона ребёнка',
    description:
      'Установите на телефон ребёнка и привяжите его QR-кодом из родительского кабинета.',
    app: 'gmd-child',
    icon: '/app-icon-child.png',
    rustoreUrl: 'https://www.rustore.ru/catalog/app/pro.periscop.child',
    instructions: [
      'На телефоне ребёнка откройте страницу «Перископ Ребёнка» в RuStore и нажмите «Установить».',
      'Запустите приложение и выдайте запрошенные разрешения.',
      'Родитель в кабинете создаёт QR-код, ребёнок сканирует его в приложении.',
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

function RuStoreButton({
  href,
  icon,
  title,
}: {
  href: string;
  icon: string;
  title: string;
}): ReactElement {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 transition hover:border-sky-400/50 hover:bg-sky-500/20"
    >
      <div className="flex items-center gap-3">
        <Image
          src={icon}
          alt={`Иконка «${title}»`}
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-xl shadow-sm"
        />
        <div>
          <div className="font-semibold text-white">Установить из RuStore</div>
          <div className="text-xs text-slate-400">
            Рекомендуем — автообновления и без «неизвестных источников»
          </div>
        </div>
      </div>
      <span className="shrink-0 text-sm font-medium text-sky-300">Открыть →</span>
    </a>
  );
}

function AppCard({
  section,
  latest,
}: {
  section: AppSection;
  latest: ReturnType<typeof pickLatest>;
}): ReactElement {
  return (
    <section className="mb-8 rounded-lg border border-slate-700/60 bg-slate-900/70 p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-white">{section.title}</h2>
      <p className="mt-1 mb-5 text-sm text-slate-300">{section.description}</p>

      <RuStoreButton href={section.rustoreUrl} icon={section.icon} title={section.title} />

      {latest.abis.length > 0 && (
        <details className="mt-5 text-sm text-slate-300">
          <summary className="cursor-pointer font-medium text-slate-200">
            Или скачать APK напрямую
          </summary>
          <p className="mt-2 text-xs text-slate-400">
            Запасной вариант, если RuStore недоступен. Потребуется разрешить установку из
            неизвестных источников; автообновление придёт только через RuStore.
          </p>
          <div className="mt-3 mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-white">
              Актуальная версия — v{latest.version}
            </span>
            <span className="text-xs text-slate-400">
              {new Date(latest.abis[0].uploadedAt).toLocaleString('ru')}
            </span>
          </div>
          <div className="space-y-2">
            {latest.abis.map((f) => (
              <a
                key={f.filename}
                href={`/api/public/download/${encodeURIComponent(f.filename)}`}
                className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-950/40 px-4 py-3 transition hover:border-slate-500 hover:bg-slate-900"
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
            ))}
          </div>
        </details>
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
      <p className="mb-8 text-slate-300">
        Два приложения: одно для своего телефона (родителю), второе — на телефон ребёнка. Оба
        доступны в RuStore — так вы получите автоматические обновления.
      </p>

      {SECTIONS.map((section) => (
        <AppCard key={section.app} section={section} latest={pickLatest(files, section.app)} />
      ))}
    </div>
  );
}
