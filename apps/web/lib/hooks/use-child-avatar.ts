// apps/web/lib/hooks/use-child-avatar.ts
'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { childrenApi, type SetAvatarInput } from '@/lib/api/children';
import { parseAvatarKey, presetSrc } from '@/lib/avatar/presets';

const avatarQueryKey = (childId: string, version: string | null) =>
  ['child-avatar', childId, version] as const;

/**
 * Object URL фото ребёнка или `null` (фото нет, грузится или ошибка — тогда
 * вызывающий рисует букву). Кэш по версии из avatarKey: новая версия = новый
 * ключ, поэтому staleTime бесконечный.
 */
export function useChildAvatarUrl(
  childId: string,
  avatarKey: string | null | undefined,
): string | null {
  const parsed = parseAvatarKey(avatarKey);
  const version = parsed.kind === 'photo' ? parsed.version : null;
  const q = useQuery({
    queryKey: avatarQueryKey(childId, version),
    queryFn: () => childrenApi.fetchAvatar(childId),
    enabled: version !== null,
    staleTime: Infinity,
  });
  const blob = version !== null ? (q.data ?? null) : null;

  // Object URL создаём и отзываем в эффекте (а не в useMemo), чтобы двойной
  // прогон эффектов в StrictMode не отзывал ещё используемый URL.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** Готовый src картинки аватара (пресет или фото) либо `null` для буквы. */
export function useChildAvatarSrc(
  childId: string,
  avatarKey: string | null | undefined,
): string | null {
  const photoUrl = useChildAvatarUrl(childId, avatarKey);
  const parsed = parseAvatarKey(avatarKey);
  if (parsed.kind === 'preset') return presetSrc(parsed.id);
  if (parsed.kind === 'photo') return photoUrl;
  return null;
}

export function useSetChildAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetAvatarInput; blob?: Blob }) =>
      childrenApi.setAvatar(id, body),
    onSuccess: (res, { id, blob }) => {
      // Только что загруженное фото кладём в кэш под новой версией — без
      // повторного скачивания с сервера.
      const parsed = parseAvatarKey(res?.avatarKey);
      if (blob && parsed.kind === 'photo') {
        qc.setQueryData(avatarQueryKey(id, parsed.version), blob);
      }
      return qc.invalidateQueries({ queryKey: ['children'] });
    },
  });
}

export function useRemoveChildAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => childrenApi.removeAvatar(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['children'] }),
  });
}
