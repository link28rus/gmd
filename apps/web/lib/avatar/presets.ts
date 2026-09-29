// Стандартные аватары ребёнка. SVG лежат в public/avatars/<id>.svg — их пишет
// tools/avatars/generate_presets.py (тот же набор уходит в mobile-parent).
// Контракт avatarKey — docs/superpowers/specs/2026-09-29-child-avatars.md.

export const AVATAR_PRESETS = [
  { id: 'fox', label: 'Лиса' },
  { id: 'bear', label: 'Медведь' },
  { id: 'panda', label: 'Панда' },
  { id: 'cat', label: 'Кошка' },
  { id: 'bunny', label: 'Зайчик' },
  { id: 'owl', label: 'Сова' },
  { id: 'penguin', label: 'Пингвин' },
  { id: 'frog', label: 'Лягушка' },
  { id: 'lion', label: 'Лев' },
  { id: 'koala', label: 'Коала' },
  { id: 'puppy', label: 'Щенок' },
  { id: 'tiger', label: 'Тигр' },
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESETS)[number]['id'];

export type ParsedAvatarKey =
  | { kind: 'letter' }
  | { kind: 'preset'; id: AvatarPresetId }
  | { kind: 'photo'; version: string };

const PRESET_IDS = new Set<string>(AVATAR_PRESETS.map((p) => p.id));

export function parseAvatarKey(key: string | null | undefined): ParsedAvatarKey {
  if (!key) return { kind: 'letter' };
  if (key.startsWith('preset:')) {
    const id = key.slice('preset:'.length);
    // Неизвестный пресет (например, добавлен в более новой версии) — буква.
    return PRESET_IDS.has(id) ? { kind: 'preset', id: id as AvatarPresetId } : { kind: 'letter' };
  }
  if (key.startsWith('photo:')) {
    const version = key.slice('photo:'.length);
    return version ? { kind: 'photo', version } : { kind: 'letter' };
  }
  return { kind: 'letter' };
}

export function presetSrc(id: AvatarPresetId): string {
  return `/avatars/${id}.svg`;
}
