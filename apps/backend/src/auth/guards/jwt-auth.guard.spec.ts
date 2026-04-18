/* eslint-disable @typescript-eslint/no-explicit-any */
import { JwtAuthGuard } from './jwt-auth.guard';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '../jwt.service';

function ctx(auth?: string): ExecutionContext {
  const req: any = { headers: auth ? { authorization: auth } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const mockJwt = {
    verifyAccessToken: jest.fn(),
  } as unknown as JwtService;

  it('401 если нет Authorization', async () => {
    const guard = new JwtAuthGuard(mockJwt);
    await expect(guard.canActivate(ctx())).rejects.toThrow(UnauthorizedException);
  });

  it('401 если не Bearer', async () => {
    const guard = new JwtAuthGuard(mockJwt);
    await expect(guard.canActivate(ctx('Basic abc'))).rejects.toThrow(UnauthorizedException);
  });

  it('401 если verify бросает', async () => {
    (mockJwt.verifyAccessToken as jest.Mock).mockRejectedValueOnce(new Error('bad'));
    const guard = new JwtAuthGuard(mockJwt);
    await expect(guard.canActivate(ctx('Bearer xyz'))).rejects.toThrow(UnauthorizedException);
  });

  it('true + req.user если verify ok', async () => {
    (mockJwt.verifyAccessToken as jest.Mock).mockResolvedValueOnce({
      sub: 'u1',
      familyId: 'f1',
      role: 'owner',
    });
    const guard = new JwtAuthGuard(mockJwt);
    const c = ctx('Bearer xyz');
    expect(await guard.canActivate(c)).toBe(true);
    const req = c.switchToHttp().getRequest() as any;
    expect(req.user).toEqual({ userId: 'u1', familyId: 'f1', role: 'owner' });
  });
});
