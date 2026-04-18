import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ChildDeviceService } from '../child-device.service';

@Injectable()
export class ChildAuthGuard implements CanActivate {
  constructor(@Inject(ChildDeviceService) private readonly svc: ChildDeviceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.headers['x-child-token'];
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException({
        code: 'unauthorized',
        message: 'Missing X-Child-Token',
      });
    }
    const ctx = await this.svc.verifyToken(token);
    if (!ctx) {
      throw new UnauthorizedException({ code: 'unauthorized', message: 'Invalid token' });
    }
    req.childDevice = ctx;
    this.svc.touchLastSeen(ctx.deviceId);
    return true;
  }
}
