import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PinVerifiedGuard } from './pin-verified.guard';
import type { PinService } from '../pin.service';

function makeCtx(user: { userId?: string } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PinVerifiedGuard', () => {
  it('throws 403 when req.user missing', async () => {
    const pin = { isVerified: jest.fn() } as unknown as PinService;
    const guard = new PinVerifiedGuard(pin);
    await expect(guard.canActivate(makeCtx(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws 403 with pin_verification_required when no marker', async () => {
    const pin = { isVerified: jest.fn(async () => false) } as unknown as PinService;
    const guard = new PinVerifiedGuard(pin);
    await expect(guard.canActivate(makeCtx({ userId: 'u1' }))).rejects.toMatchObject({
      response: { code: 'pin_verification_required' },
    });
  });

  it('returns true when marker present', async () => {
    const pin = { isVerified: jest.fn(async () => true) } as unknown as PinService;
    const guard = new PinVerifiedGuard(pin);
    await expect(guard.canActivate(makeCtx({ userId: 'u1' }))).resolves.toBe(true);
  });
});
