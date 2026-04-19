/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { ConsentRequiredGuard } from './consent-required.guard';
import type { ConsentService } from '../consent.service';

function makeCtx(user?: { userId: string }) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as any;
}

function makeConsent(requiresFn: (id: string) => Promise<boolean>) {
  return {
    userRequiresConsentById: jest.fn(requiresFn),
  } as unknown as ConsentService;
}

describe('ConsentRequiredGuard', () => {
  it('нет user в req → true (JwtAuthGuard решит)', async () => {
    const guard = new ConsentRequiredGuard(makeConsent(() => Promise.resolve(false)));
    const result = await guard.canActivate(makeCtx(undefined));
    expect(result).toBe(true);
  });

  it('user с актуальной версией → true', async () => {
    const guard = new ConsentRequiredGuard(makeConsent(() => Promise.resolve(false)));
    const result = await guard.canActivate(makeCtx({ userId: 'u-1' }));
    expect(result).toBe(true);
  });

  it('user требует consent → 403 consent_required', async () => {
    const guard = new ConsentRequiredGuard(makeConsent(() => Promise.resolve(true)));
    await expect(guard.canActivate(makeCtx({ userId: 'u-1' }))).rejects.toThrow(ForbiddenException);
  });

  it('403 содержит code=consent_required', async () => {
    const guard = new ConsentRequiredGuard(makeConsent(() => Promise.resolve(true)));
    try {
      await guard.canActivate(makeCtx({ userId: 'u-1' }));
      fail('должен был бросить');
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({ code: 'consent_required' });
    }
  });
});
