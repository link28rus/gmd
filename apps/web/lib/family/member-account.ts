// v0.72.0: владелец заводит аккаунт участника сам — генерация пароля, проверка формы,
// текст «данные для входа». Правила полей — как у backend CreateMemberSchema.

export const MEMBER_PASSWORD_MIN = 8;
export const MEMBER_PASSWORD_MAX = 128;
export const MEMBER_NAME_MAX = 80;
export const GENERATED_PASSWORD_LENGTH = 12;

// Без похожих символов: нет 0/O/o, 1/l/I/i.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
export const PASSWORD_ALPHABET = UPPER + LOWER + DIGITS;

type RandomFill = (buf: Uint32Array) => Uint32Array;

const defaultFill: RandomFill = (buf) => globalThis.crypto.getRandomValues(buf);

/** Равномерный индекс 0..n-1 без смещения по модулю (отбрасываем «хвост» диапазона). */
function randomIndex(n: number, fill: RandomFill): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    fill(buf);
    const v = buf[0]!;
    if (v < limit) return v % n;
  }
}

/**
 * Читаемый надёжный пароль: заглавные, строчные и цифры (минимум по одному каждого),
 * без похожих символов. Источник случайности — crypto.getRandomValues.
 */
export function generateMemberPassword(
  length: number = GENERATED_PASSWORD_LENGTH,
  fill: RandomFill = defaultFill,
): string {
  const len = Math.max(length, 3);
  const pick = (set: string): string => set[randomIndex(set.length, fill)]!;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < len) chars.push(pick(PASSWORD_ALPHABET));
  // Fisher–Yates, чтобы обязательные символы не стояли всегда в начале.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, fill);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

export interface NewMemberForm {
  lastName: string;
  firstName: string;
  middleName: string;
  email: string;
  password: string;
}

export type NewMemberErrors = Partial<Record<keyof NewMemberForm, string>>;

const NAME_BAD_CHARS = /[<>"\\]/;
// Простая проверка формы адреса; точную делает backend (z.string().email()).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nameError(value: string, requiredMessage?: string): string | undefined {
  const v = value.trim();
  if (!v) return requiredMessage;
  if (v.length > MEMBER_NAME_MAX) return `Не длиннее ${MEMBER_NAME_MAX} символов`;
  if (NAME_BAD_CHARS.test(v)) return 'Нельзя использовать символы < > " \\';
  return undefined;
}

/** Ошибки по полям; пустой объект — форму можно отправлять. */
export function validateNewMember(f: NewMemberForm): NewMemberErrors {
  const errors: NewMemberErrors = {};
  // ФИО как при регистрации: фамилия и имя обязательны, отчество — по желанию.
  const last = nameError(f.lastName, 'Укажите фамилию');
  if (last) errors.lastName = last;
  const first = nameError(f.firstName, 'Укажите имя');
  if (first) errors.firstName = first;
  const middle = nameError(f.middleName);
  if (middle) errors.middleName = middle;
  const email = f.email.trim();
  if (!email) errors.email = 'Укажите email';
  else if (email.length > 320 || !EMAIL_RE.test(email)) errors.email = 'Проверьте email';
  if (f.password.length < MEMBER_PASSWORD_MIN) {
    errors.password = `Не короче ${MEMBER_PASSWORD_MIN} символов`;
  } else if (f.password.length > MEMBER_PASSWORD_MAX) {
    errors.password = `Не длиннее ${MEMBER_PASSWORD_MAX} символов`;
  }
  return errors;
}

/** Текст для мессенджера: где войти, email и пароль. */
export function memberCredentialsText(origin: string, email: string, password: string): string {
  const base = origin.replace(/\/+$/, '');
  return (
    `Вход в Перископ: ${base}/login — email: ${email}, пароль: ${password}. ` +
    'Политику конфиденциальности примете при первом входе.'
  );
}
