import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '../jwt.service';
import type { JwtPayload } from '../jwt.service';
import { StaleTokenService } from '../stale-token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Optional() @Inject(StaleTokenService) private readonly stale?: StaleTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'unauthorized', message: 'Missing Bearer token' });
    }
    const token = header.slice('Bearer '.length);
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException({ code: 'unauthorized', message: 'Invalid token' });
    }
    // v0.71.0: членство в семье сменилось после выпуска токена → клиент делает refresh.
    if (this.stale && (await this.stale.isStale(payload.sub, payload.issuedAtMs))) {
      throw new UnauthorizedException({ code: 'token_stale', message: 'Token is stale' });
    }
    req.user = {
      userId: payload.sub,
      email: payload.email,
      familyId: payload.familyId,
      role: payload.role,
    };
    return true;
  }
}
