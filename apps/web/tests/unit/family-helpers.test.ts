import { ApiError } from '@/lib/api/client';
import {
  familyErrorMessage,
  formatInviteCode,
  isValidInviteCode,
  joinBlockFromError,
  normalizeInviteCode,
} from '@/lib/api/family';
import {
  PENDING_FAMILY_INVITE_KEY,
  clearPendingFamilyInvite,
  readPendingFamilyInvite,
  savePendingFamilyInvite,
} from '@/lib/family/pending-invite';

describe('коды приглашения', () => {
  it('нормализует ввод как backend', () => {
    expect(normalizeInviteCode(' abcd-ef23 ')).toBe('ABCDEF23');
  });

  it('проверяет алфавит Crockford', () => {
    expect(isValidInviteCode('ABCDEF23')).toBe(true);
    expect(isValidInviteCode('ABCDEFIL')).toBe(false); // I и L нет в алфавите
    expect(isValidInviteCode('ABC')).toBe(false);
  });

  it('форматирует с дефисом посередине', () => {
    expect(formatInviteCode('ABCDEF23')).toBe('ABCD-EF23');
  });
});

describe('ошибки', () => {
  it('current_family_not_empty → причина и детали', () => {
    const e = new ApiError(409, 'current_family_not_empty', 'x', {
      reason: 'has_members',
      currentFamilyName: 'Моя',
      children: 0,
      members: 1,
    });
    expect(joinBlockFromError(e)).toEqual({
      reason: 'has_members',
      currentFamilyName: 'Моя',
      children: 0,
      members: 1,
    });
  });

  it('already_member → причина', () => {
    expect(joinBlockFromError(new ApiError(409, 'already_member', 'x'))).toEqual({
      reason: 'already_member',
    });
  });

  it('человеческие тексты по code', () => {
    expect(familyErrorMessage(new ApiError(409, 'owner_must_transfer', 'x'))).toMatch(
      /передайте права/,
    );
    expect(familyErrorMessage(new ApiError(409, 'too_many_invites', 'x'))).toMatch(/отзовите/);
    expect(familyErrorMessage(new ApiError(403, 'forbidden', 'x'))).toMatch(/владелец/);
    expect(familyErrorMessage(new TypeError('fetch failed'))).toMatch(/Нет связи/);
  });
});

describe('отложенное приглашение в localStorage', () => {
  afterEach(() => window.localStorage.clear());

  it('сохраняет и читает свежий код', () => {
    savePendingFamilyInvite('ABCDEF23');
    expect(readPendingFamilyInvite()).toBe('ABCDEF23');
    clearPendingFamilyInvite();
    expect(readPendingFamilyInvite()).toBeNull();
  });

  it('код старше 7 дней удаляется', () => {
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(
      PENDING_FAMILY_INVITE_KEY,
      JSON.stringify({ code: 'ABCDEF23', savedAt: old }),
    );
    expect(readPendingFamilyInvite()).toBeNull();
    expect(window.localStorage.getItem(PENDING_FAMILY_INVITE_KEY)).toBeNull();
  });

  it('битое значение удаляется', () => {
    window.localStorage.setItem(PENDING_FAMILY_INVITE_KEY, 'not-json');
    expect(readPendingFamilyInvite()).toBeNull();
    expect(window.localStorage.getItem(PENDING_FAMILY_INVITE_KEY)).toBeNull();
  });
});
