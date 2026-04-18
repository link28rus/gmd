import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ADMIN_CONFIG } from '../admin.tokens';
import type { AdminConfig } from '../admin.tokens';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ADMIN_CONFIG) private readonly cfg: AdminConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: { email?: string } }>();
    const user = req.user;
    if (!user?.email) {
      throw new ForbiddenException({ code: 'forbidden', message: 'Admin only' });
    }
    const email = user.email.toLowerCase().trim();
    if (!this.cfg.emails.includes(email)) {
      throw new ForbiddenException({ code: 'forbidden', message: 'Admin only' });
    }
    return true;
  }
}
