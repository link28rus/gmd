import { z } from 'zod';

/**
 * Стандартные аватары ребёнка (v0.61, docs/superpowers/specs/2026-09-29-child-avatars.md).
 * Единственный источник списка на backend; SVG лежат в apps/web/public/avatars/ и
 * apps/mobile-parent/assets/avatars/ (генератор tools/avatars/generate_presets.py).
 */
export const CHILD_AVATAR_PRESETS = [
  'fox',
  'bear',
  'panda',
  'cat',
  'bunny',
  'owl',
  'penguin',
  'frog',
  'lion',
  'koala',
  'puppy',
  'tiger',
] as const;
export type ChildAvatarPreset = (typeof CHILD_AVATAR_PRESETS)[number];

export const CHILD_AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ChildAvatarMime = (typeof CHILD_AVATAR_MIMES)[number];

/** Лимит размера фото после декодирования base64. */
export const CHILD_AVATAR_MAX_BYTES = 300 * 1024;

/**
 * PUT /family/children/:childId/avatar — ровно одно из `preset` / `photo`.
 * Размер base64 здесь не ограничивается: превышение лимита — отдельная ошибка
 * 413 `avatar_too_large`, её проверяет сервис.
 */
export const SetChildAvatarSchema = z.union([
  z.object({ preset: z.enum(CHILD_AVATAR_PRESETS) }).strict(),
  z
    .object({
      photo: z
        .object({
          mime: z.enum(CHILD_AVATAR_MIMES),
          base64: z.string().min(1),
        })
        .strict(),
    })
    .strict(),
]);
export type SetChildAvatarDto = z.infer<typeof SetChildAvatarSchema>;
