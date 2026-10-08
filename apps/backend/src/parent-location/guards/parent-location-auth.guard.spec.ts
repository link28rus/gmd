/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ParentLocationAuthGuard } from './parent-location-auth.guard';
import type { ParentLocationService } from '../parent-location.service';

function ctx(token?: string): { c: ExecutionContext; req: any } {
  const req: any = { headers: token ? { 'x-parent-location-token': token } : {} };
  const c = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { c, req };
}

describe('ParentLocationAuthGuard', () => {
  const svc = { verifyToken: jest.fn() } as unknown as ParentLocationService;
  const guard = new ParentLocationAuthGuard(svc);

  it('401 без заголовка', async () => {
    await expect(guard.canActivate(ctx().c)).rejects.toThrow(UnauthorizedException);
  });

  it('401 если токен не прошёл проверку', async () => {
    (svc.verifyToken as jest.Mock).mockResolvedValueOnce(null);
    await expect(guard.canActivate(ctx('x').c)).rejects.toThrow(UnauthorizedException);
  });

  it('кладёт контекст в req.parentLocation', async () => {
    (svc.verifyToken as jest.Mock).mockResolvedValueOnce({ deviceId: 'pd1', userId: 'u1' });
    const { c, req } = ctx('x');
    expect(await guard.canActivate(c)).toBe(true);
    expect(req.parentLocation).toEqual({ deviceId: 'pd1', userId: 'u1' });
  });
});
