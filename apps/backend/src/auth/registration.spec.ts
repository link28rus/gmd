import { registrationEnabled } from './registration';

describe('registrationEnabled', () => {
  it('в production по умолчанию закрыта', () => {
    expect(registrationEnabled({ NODE_ENV: 'production' })).toBe(false);
  });
  it('в dev/test по умолчанию открыта', () => {
    expect(registrationEnabled({ NODE_ENV: 'test' })).toBe(true);
    expect(registrationEnabled({})).toBe(true);
  });
  it('явный флаг важнее NODE_ENV', () => {
    expect(registrationEnabled({ NODE_ENV: 'production', REGISTRATION_ENABLED: 'true' })).toBe(
      true,
    );
    expect(registrationEnabled({ NODE_ENV: 'test', REGISTRATION_ENABLED: 'false' })).toBe(false);
  });
});
