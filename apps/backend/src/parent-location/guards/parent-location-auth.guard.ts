import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ParentLocationService } from '../parent-location.service';

/**
 * v0.70.0: аутентификация нативной службы геолокации родителя по
 * `X-Parent-Location-Token`. 401 — клиент останавливает службу и стирает токен.
 */
@Injectable()
export class ParentLocationAuthGuard implements CanActivate {
  constructor(@Inject(ParentLocationService) private readonly svc: ParentLocationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.headers['x-parent-location-token'];
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException({
        code: 'unauthorized',
        message: 'Missing X-Parent-Location-Token',
      });
    }
    const ctx = await this.svc.verifyToken(token);
    if (!ctx) {
      throw new UnauthorizedException({ code: 'unauthorized', message: 'Invalid token' });
    }
    req.parentLocation = ctx;
    return true;
  }
}
