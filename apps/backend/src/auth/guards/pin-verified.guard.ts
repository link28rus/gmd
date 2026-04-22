import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { PinService } from '../pin.service';

// Требует «свежей» PIN-верификации (POST /me/pin/verify не ранее чем
// PIN_VERIFY_TTL_SECONDS назад). Ставится ПОСЛЕ JwtAuthGuard, т.к. опирается
// на req.user.userId. Если marker'а нет — 403 pin_verification_required, и
// клиент должен открыть модалку «Введите PIN» перед повтором запроса.
@Injectable()
export class PinVerifiedGuard implements CanActivate {
  constructor(@Inject(PinService) private readonly pin: PinService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.userId;
    if (!userId) {
      throw new ForbiddenException({
        code: 'pin_verification_required',
        message: 'PIN verification required',
      });
    }
    const verified = await this.pin.isVerified(userId);
    if (!verified) {
      throw new ForbiddenException({
        code: 'pin_verification_required',
        message: 'PIN verification required',
      });
    }
    return true;
  }
}
