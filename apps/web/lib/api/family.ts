// apps/web/lib/api/family.ts
// Участники семьи (v0.71.0): docs/superpowers/specs/2026-10-08-family-members.md
import { ApiError, apiFetch } from './client';

export type FamilyRole = 'owner' | 'parent';

export interface FamilyMember {
  userId: string;
  displayName: string;
  email: string;
  role: FamilyRole;
  joinedAt: string;
  isMe: boolean;
}

export interface FamilyMembersResponse {
  family: { id: string; name: string };
  myRole: FamilyRole;
  /** Владелец первым, дальше по времени вступления. */
  members: FamilyMember[];
}

export interface MemberInvite {
  id: string;
  code: string;
  url: string;
  expiresAt: string;
  createdAt: string;
}

export type JoinBlockReason = 'already_member' | 'has_children' | 'has_members';

export interface InvitePreview {
  family: { name: string };
  invitedBy: string;
  expiresAt: string;
  canJoin: boolean;
  reason?: JoinBlockReason;
  currentFamilyName?: string;
  children?: number;
  members?: number;
}

export interface AcceptInviteResponse {
  family: { id: string; name: string };
  role: 'parent';
}

/** Лимит активных приглашений на семью (backend отвечает 409 too_many_invites). */
export const MAX_ACTIVE_MEMBER_INVITES = 10;
/** Срок жизни приглашения взрослого. */
export const MEMBER_INVITE_TTL_DAYS = 7;
/** Длина названия семьи по Zod-схеме backend'а. */
export const FAMILY_NAME_MAX = 120;

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** Как `normalizeInviteCode` на backend'е: без пробелов и дефисов, верхний регистр. */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** 8 символов Crockford base32 (без I, L, O, U). */
export function isValidInviteCode(code: string): boolean {
  return CODE_RE.test(code);
}

/** ABCDEFGH → ABCD-EFGH — для чтения вслух и переписывания. */
export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export const getMembers = (): Promise<FamilyMembersResponse> =>
  apiFetch<FamilyMembersResponse>('/api/family/members');

export const createMemberInvite = async (): Promise<MemberInvite> =>
  (await apiFetch<{ invite: MemberInvite }>('/api/family/member-invites', { method: 'POST' }))
    .invite;

export const listMemberInvites = async (): Promise<MemberInvite[]> =>
  (await apiFetch<{ invites: MemberInvite[] }>('/api/family/member-invites')).invites;

export const revokeMemberInvite = (id: string): Promise<void> =>
  apiFetch<void>(`/api/family/member-invites/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const previewMemberInvite = (code: string): Promise<InvitePreview> =>
  apiFetch<InvitePreview>(
    `/api/family/member-invites/preview?code=${encodeURIComponent(normalizeInviteCode(code))}`,
  );

export const acceptMemberInvite = (code: string): Promise<AcceptInviteResponse> =>
  apiFetch<AcceptInviteResponse>('/api/family/member-invites/accept', {
    method: 'POST',
    body: JSON.stringify({ code: normalizeInviteCode(code) }),
  });

export const removeMember = (userId: string): Promise<void> =>
  apiFetch<void>(`/api/family/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });

/** Выйти из семьи (только `parent`). Ответ — новая пустая семья пользователя. */
export const leaveFamily = (): Promise<{ family: { id: string; name: string } }> =>
  apiFetch<{ family: { id: string; name: string } }>('/api/family/leave', { method: 'POST' });

export const transferOwnership = (userId: string): Promise<void> =>
  apiFetch<void>('/api/family/transfer-ownership', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });

export const renameFamily = async (
  id: string,
  name: string,
): Promise<{ id: string; name: string }> =>
  (
    await apiFetch<{ family: { id: string; name: string } }>(
      `/api/family/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
    )
  ).family;

export const familyApi = {
  getMembers,
  createMemberInvite,
  listMemberInvites,
  revokeMemberInvite,
  previewMemberInvite,
  acceptMemberInvite,
  removeMember,
  leaveFamily,
  transferOwnership,
  renameFamily,
};

/** Причина отказа из 409 `current_family_not_empty` (поля лежат рядом с code/message). */
export function joinBlockFromError(e: unknown): {
  reason: JoinBlockReason;
  currentFamilyName?: string;
  children?: number;
  members?: number;
} | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'already_member') return { reason: 'already_member' };
  if (e.code !== 'current_family_not_empty') return null;
  const d = e.details;
  const reason = d.reason === 'has_members' ? 'has_members' : 'has_children';
  return {
    reason,
    currentFamilyName: typeof d.currentFamilyName === 'string' ? d.currentFamilyName : undefined,
    children: typeof d.children === 'number' ? d.children : undefined,
    members: typeof d.members === 'number' ? d.members : undefined,
  };
}

/** Человеческий текст ошибки по `code` backend'а. */
export function familyErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) {
    // fetch() бросает TypeError без сети; SyntaxError — прокси вернул не-JSON.
    return 'Нет связи с сервером — проверьте интернет и попробуйте ещё раз.';
  }
  switch (e.code) {
    case 'forbidden':
      return 'Это может сделать только владелец семьи.';
    case 'too_many_invites':
      return `Слишком много активных приглашений (не больше ${MAX_ACTIVE_MEMBER_INVITES}) — отзовите ненужные.`;
    case 'owner_must_transfer':
      return 'Владелец не может выйти из семьи — сначала передайте права другому участнику.';
    case 'cannot_remove_self':
      return 'Себя удалить нельзя — используйте «Выйти из семьи».';
    case 'cannot_transfer_to_self':
      return 'Вы уже владелец семьи.';
    case 'not_found':
      return 'Не найдено — возможно, данные уже изменились. Обновите страницу.';
    case 'invite_invalid':
      return 'Приглашение не найдено, истекло или уже использовано.';
    case 'already_member':
      return 'Вы уже состоите в этой семье.';
    case 'current_family_not_empty':
      return e.details.reason === 'has_members'
        ? 'В вашей текущей семье есть другие взрослые — сначала выйдите из неё (владельцу — передать права).'
        : 'В вашей текущей семье есть дети — сначала удалите их в кабинете.';
    case 'consent_required':
      return 'Сначала примите актуальную политику конфиденциальности (баннер вверху страницы).';
    case 'bad_request':
    case 'validation_failed':
      return `Проверьте введённые данные (название семьи — от 1 до ${FAMILY_NAME_MAX} символов).`;
    case 'rate_limited':
      return 'Слишком много запросов — подождите несколько минут.';
    case 'unauthorized':
    case 'unauthenticated':
    case 'token_stale':
      return 'Сессия истекла — войдите заново.';
    default:
      break;
  }
  if (e.status >= 500) return 'Сервер временно недоступен — попробуйте позже.';
  // Сообщения backend'а бывают на английском — показываем общий текст.
  return 'Не удалось выполнить действие — попробуйте ещё раз.';
}
