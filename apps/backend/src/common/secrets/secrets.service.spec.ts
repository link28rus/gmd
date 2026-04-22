import { SecretsService } from './secrets.service';

describe('SecretsService', () => {
  const origKey = process.env.SMTP_SECRET_KEY;

  afterEach(() => {
    if (origKey === undefined) {
      delete process.env.SMTP_SECRET_KEY;
    } else {
      process.env.SMTP_SECRET_KEY = origKey;
    }
  });

  it('encrypt→decrypt round-trip с hex-ключом', () => {
    process.env.SMTP_SECRET_KEY = 'a'.repeat(64);
    const svc = new SecretsService();
    const plain = 'hunter2';
    const enc = svc.encrypt(plain);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(svc.decrypt(enc)).toBe(plain);
  });

  it('encrypt→decrypt round-trip со строковым ключом (через SHA-256)', () => {
    process.env.SMTP_SECRET_KEY = 'my-pass-phrase';
    const svc = new SecretsService();
    const plain = 'secret-value';
    const enc = svc.encrypt(plain);
    expect(svc.decrypt(enc)).toBe(plain);
  });

  it('без SMTP_SECRET_KEY — encrypt возвращает plain, decrypt plain → plain', () => {
    delete process.env.SMTP_SECRET_KEY;
    const svc = new SecretsService();
    expect(svc.isConfigured()).toBe(false);
    expect(svc.encrypt('abc')).toBe('abc');
    expect(svc.decrypt('abc')).toBe('abc');
  });

  it('без ключа — decrypt зашифрованного значения бросает ошибку', () => {
    process.env.SMTP_SECRET_KEY = 'a'.repeat(64);
    const svc1 = new SecretsService();
    const enc = svc1.encrypt('top-secret');
    delete process.env.SMTP_SECRET_KEY;
    const svc2 = new SecretsService();
    expect(() => svc2.decrypt(enc)).toThrow(/SMTP_SECRET_KEY/);
  });

  it('decrypt чужого ключа — ошибка', () => {
    process.env.SMTP_SECRET_KEY = 'a'.repeat(64);
    const svc1 = new SecretsService();
    const enc = svc1.encrypt('top-secret');
    process.env.SMTP_SECRET_KEY = 'b'.repeat(64);
    const svc2 = new SecretsService();
    expect(() => svc2.decrypt(enc)).toThrow();
  });

  it('isEncrypted отличает prefix', () => {
    process.env.SMTP_SECRET_KEY = 'a'.repeat(64);
    const svc = new SecretsService();
    expect(svc.isEncrypted('plain')).toBe(false);
    expect(svc.isEncrypted(svc.encrypt('x'))).toBe(true);
  });
});
