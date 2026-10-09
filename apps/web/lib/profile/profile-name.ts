// apps/web/lib/profile/profile-name.ts
// v0.75.0: ФИО в профиле кабинета — чистые хелперы формы (без React, с тестами).

/** Лимит части ФИО — как nameField в backend (register.dto.ts). */
export const NAME_PART_MAX = 80;
/** Символы, которые backend не принимает в ФИО. */
const FORBIDDEN = /[<>"\\]/;

export interface NameParts {
  lastName: string;
  firstName: string;
  middleName: string;
}

export interface MeNameFields {
  name: string | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
}

/**
 * Значения формы. Частей нет, а `name` есть (аккаунты до ФИО при регистрации) —
 * раскладываем его «Фамилия Имя Отчество…»; одно слово считаем именем.
 */
export function initialNameParts(u: MeNameFields): NameParts {
  if (u.lastName || u.firstName || u.middleName) {
    return {
      lastName: u.lastName ?? '',
      firstName: u.firstName ?? '',
      middleName: u.middleName ?? '',
    };
  }
  const words = (u.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lastName: '', firstName: '', middleName: '' };
  if (words.length === 1) return { lastName: '', firstName: words[0], middleName: '' };
  return { lastName: words[0], firstName: words[1], middleName: words.slice(2).join(' ') };
}

/** Ошибка формы или null, если можно отправлять. */
export function validateNameParts(p: NameParts): string | null {
  if (!p.lastName.trim()) return 'Укажите фамилию';
  if (!p.firstName.trim()) return 'Укажите имя';
  for (const v of [p.lastName, p.firstName, p.middleName]) {
    if (v.trim().length > NAME_PART_MAX) return `Не длиннее ${NAME_PART_MAX} символов`;
    if (FORBIDDEN.test(v)) return 'Нельзя использовать символы < > " \\';
  }
  return null;
}

/** Тело PATCH /api/me: пустое отчество — null (убрать). */
export function namePayload(p: NameParts): {
  lastName: string;
  firstName: string;
  middleName: string | null;
} {
  return {
    lastName: p.lastName.trim(),
    firstName: p.firstName.trim(),
    middleName: p.middleName.trim() || null,
  };
}
