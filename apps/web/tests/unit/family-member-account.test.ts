import { webcrypto } from 'node:crypto';
import { ApiError } from '@/lib/api/client';
import {
  EMAIL_TAKEN_MESSAGE,
  createMemberErrorMessage,
  familyErrorMessage,
} from '@/lib/api/family';
import {
  GENERATED_PASSWORD_LENGTH,
  PASSWORD_ALPHABET,
  generateMemberPassword,
  memberCredentialsText,
  validateNewMember,
} from '@/lib/family/member-account';

const nodeFill = (buf: Uint32Array): Uint32Array => webcrypto.getRandomValues(buf);

describe('generateMemberPassword', () => {
  it('12 символов из читаемого алфавита, есть заглавная, строчная и цифра', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateMemberPassword(undefined, nodeFill);
      expect(p).toHaveLength(GENERATED_PASSWORD_LENGTH);
      expect([...p].every((c) => PASSWORD_ALPHABET.includes(c))).toBe(true);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).not.toMatch(/[0O1lIo]/);
    }
  });

  it('по умолчанию берёт случайность из crypto.getRandomValues', () => {
    const spy = jest.spyOn(globalThis.crypto, 'getRandomValues');
    const p = generateMemberPassword();
    expect(p).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('пароли не повторяются', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateMemberPassword(12, nodeFill)));
    expect(set.size).toBe(200);
  });

  it('отбрасывает значения из «хвоста» диапазона (без смещения по модулю)', () => {
    // Сначала значение за пределом limit, затем 0 — индекс 0 у каждого выбора.
    let calls = 0;
    const fill = (buf: Uint32Array): Uint32Array => {
      buf[0] = calls++ % 2 === 0 ? 0xffffffff : 0;
      return buf;
    };
    const p = generateMemberPassword(4, fill);
    expect(p).toHaveLength(4);
    expect([...p].every((c) => PASSWORD_ALPHABET.includes(c))).toBe(true);
  });
});

describe('validateNewMember', () => {
  const ok = {
    lastName: 'Иванова',
    firstName: 'Мария',
    middleName: '',
    email: 'maria@example.com',
    password: 'Abcdefg2',
  };

  it('валидная форма без ошибок (отчество необязательно)', () => {
    expect(validateNewMember(ok)).toEqual({});
  });

  it('обязательны фамилия, имя, email и длина пароля', () => {
    const e = validateNewMember({
      lastName: '',
      firstName: ' ',
      middleName: '',
      email: 'nope',
      password: 'short',
    });
    expect(Object.keys(e).sort()).toEqual(['email', 'firstName', 'lastName', 'password']);
    expect(e.lastName).toBe('Укажите фамилию');
  });

  it('запрещённые символы в ФИО как на backend', () => {
    expect(validateNewMember({ ...ok, lastName: 'Иванова<script>' }).lastName).toBeDefined();
    expect(validateNewMember({ ...ok, middleName: 'Ивановна"' }).middleName).toBeDefined();
  });
});

describe('memberCredentialsText', () => {
  it('ссылка на вход, email, пароль и про политику', () => {
    expect(memberCredentialsText('https://gmd.link28rus.ru/', 'a@b.ru', 'Xy3kPq9mWz4R')).toBe(
      'Вход в Перископ: https://gmd.link28rus.ru/login — email: a@b.ru, пароль: Xy3kPq9mWz4R. ' +
        'Политику конфиденциальности примете при первом входе.',
    );
  });
});

describe('ошибки создания участника', () => {
  it('email_taken → предложить приглашение', () => {
    const e = new ApiError(409, 'email_taken', 'x');
    expect(EMAIL_TAKEN_MESSAGE).toBe(
      'Этот email уже зарегистрирован в Перископе — отправьте человеку приглашение',
    );
    expect(familyErrorMessage(e)).toBe(EMAIL_TAKEN_MESSAGE);
    expect(createMemberErrorMessage(e)).toBe(EMAIL_TAKEN_MESSAGE);
  });

  it('400 валидации называет поля', () => {
    const e = new ApiError(400, 'bad_request', 'Validation failed', {
      details: [
        { path: ['email'], message: 'Invalid email' },
        { path: ['password'], message: 'too short' },
      ],
    });
    expect(createMemberErrorMessage(e)).toBe('Проверьте поля: Email, Пароль.');
  });

  it('consent_required и forbidden — общие тексты', () => {
    expect(createMemberErrorMessage(new ApiError(403, 'consent_required', 'x'))).toMatch(
      /политику конфиденциальности/,
    );
    expect(createMemberErrorMessage(new ApiError(403, 'forbidden', 'x'))).toMatch(/владелец/);
  });
});
