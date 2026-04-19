import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
// NOTE: must NOT use 'import type' here — NestJS DI needs the runtime value for reflection
import type { ConsentService } from '../consent.service';

@Injectable()
export class ConsentRequiredGuard implements CanActivate {
  constructor(private readonly consent: ConsentService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ user?: { userId: string } }>();
    const user = req.user;
    if (!user) {
      // No user set — JwtAuthGuard will handle auth rejection
      return true;
    }
    const requires = await this.consent.userRequiresConsentById(user.userId);
    if (requires) {
      throw new ForbiddenException({
        code: 'consent_required',
        message: 'Policy update — accept new version',
      });
    }
    return true;
  }
}
