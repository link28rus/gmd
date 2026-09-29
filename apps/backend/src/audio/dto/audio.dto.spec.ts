import { ChildErrorSchema } from './audio.dto';

describe('ChildErrorSchema', () => {
  it('принимает MIC_BLOCKED (v0.62)', () => {
    const r = ChildErrorSchema.safeParse({
      code: 'MIC_BLOCKED',
      message: 'startForeground denied',
    });
    expect(r.success).toBe(true);
  });

  it.each(['PERMISSION_DENIED', 'MIC_BUSY', 'OEM_BLOCKED', 'NETWORK_ERROR', 'UNKNOWN'])(
    'принимает прежний код %s',
    (code) => expect(ChildErrorSchema.safeParse({ code }).success).toBe(true),
  );

  it('отвергает неизвестный код и длинное сообщение', () => {
    expect(ChildErrorSchema.safeParse({ code: 'CHILD_OFFLINE' }).success).toBe(false);
    expect(
      ChildErrorSchema.safeParse({ code: 'MIC_BLOCKED', message: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});
