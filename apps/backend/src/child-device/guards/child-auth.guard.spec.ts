/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildAuthGuard } from './child-auth.guard';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ChildDeviceService } from '../child-device.service';

function ctx(token?: string): ExecutionContext {
  const req: any = { headers: token ? { 'x-child-token': token } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ChildAuthGuard', () => {
  const mock = {
    verifyToken: jest.fn(),
    touchLastSeen: jest.fn(),
  } as unknown as ChildDeviceService;

  it('401 если нет X-Child-Token', async () => {
    const guard = new ChildAuthGuard(mock);
    await expect(guard.canActivate(ctx())).rejects.toThrow(UnauthorizedException);
  });

  it('401 если verifyToken вернул null', async () => {
    (mock.verifyToken as jest.Mock).mockResolvedValueOnce(null);
    const guard = new ChildAuthGuard(mock);
    await expect(guard.canActivate(ctx('xxx'))).rejects.toThrow(UnauthorizedException);
  });

  it('true + req.childDevice если verify ok', async () => {
    (mock.verifyToken as jest.Mock).mockResolvedValueOnce({
      deviceId: 'd1',
      childId: 'c1',
      familyId: 'f1',
      childName: 'V',
    });
    const guard = new ChildAuthGuard(mock);
    const c = ctx('xxx');
    expect(await guard.canActivate(c)).toBe(true);
    const req = c.switchToHttp().getRequest() as any;
    expect(req.childDevice.childId).toBe('c1');
    expect(mock.touchLastSeen).toHaveBeenCalledWith('d1');
  });
});
