import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '../jwt.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'unauthorized', message: 'Missing Bearer token' });
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = await this.jwt.verifyAccessToken(token);
      req.user = {
        userId: payload.sub,
        email: payload.email,
        familyId: payload.familyId,
        role: payload.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'unauthorized', message: 'Invalid token' });
    }
  }
}
