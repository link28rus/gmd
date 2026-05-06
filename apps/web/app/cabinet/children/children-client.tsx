// apps/web/app/cabinet/children/children-client.tsx
'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { useChildren } from '@/lib/hooks/use-children';
import { refreshAccessToken } from '@/lib/auth/refresh-singleflight';
import { ChildCard } from '@/components/children/child-card';
import { CreateChildDialog } from '@/components/children/create-child-dialog';

export default function ChildrenClient(): ReactElement {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAll = useAuthStore((s) => s.setAll);
  const [bootstrapping, setBootstrapping] = useState(accessToken === null);

  useEffect(() => {
    if (accessToken !== null) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await refreshAccessToken();
        if (cancelled) return;
        if (!data || !data.user || !data.family) {
          router.replace('/login');
          return;
        }
        setAll({ accessToken: data.accessToken, user: data.user, family: data.family });
      } catch {
        router.replace('/login');
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bootstrapping) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      </div>
    );
  }

  return <ChildrenContent />;
}

function ChildrenContent(): ReactElement {
  const { data, isLoading, isError, error, refetch } = useChildren();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Мои дети</h1>
        <CreateChildDialog />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            Не удалось загрузить список: {error instanceof Error ? error.message : 'ошибка'}
          </p>
          <button className="mt-2 text-sm underline" onClick={() => refetch()}>
            Попробовать снова
          </button>
        </div>
      )}
      {data && data.children.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Детей пока нет.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Нажмите «Добавить ребёнка» справа вверху.
          </p>
        </div>
      )}
      {data && data.children.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.children.map((c) => (
            <ChildCard key={c.id} child={c} />
          ))}
        </div>
      )}
    </div>
  );
}
