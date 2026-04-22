import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ADMIN_CONFIG } from '../admin.tokens';
import type { AdminConfig } from '../admin.tokens';

/**
 * Пропускает только пользователей с `role='admin'` в БД. Список email в
 * `ADMIN_EMAILS` (env) остаётся как emergency-fallback: если админ случайно
 * снял с себя права, он всё ещё сможет восстановить доступ через env.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ADMIN_CONFIG) private readonly cfg: AdminConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      user?: { userId?: string; email?: string };
    }>();
    const jwtUser = req.user;
    if (!jwtUser?.userId) {
      throw new UnauthorizedException({ code: 'unauthenticated', message: 'Login required' });
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: jwtUser.userId },
      select: { email: true, role: true, deletedAt: true, blockedAt: true },
    });
    if (!dbUser || dbUser.deletedAt) {
      throw new ForbiddenException({ code: 'forbidden', message: 'Admin only' });
    }
    if (dbUser.blockedAt) {
      throw new ForbiddenException({ code: 'account_blocked', message: 'Account is blocked' });
    }

    const email = dbUser.email.toLowerCase().trim();
    const isFallbackAdmin = this.cfg.emails.includes(email);
    const isDbAdmin = dbUser.role === 'admin';
    if (!isDbAdmin && !isFallbackAdmin) {
      throw new ForbiddenException({ code: 'forbidden', message: 'Admin only' });
    }
    return true;
  }
}
