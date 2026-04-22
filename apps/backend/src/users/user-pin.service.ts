import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PinService } from '../auth/pin.service';

export interface PinStatus {
  isSet: boolean;
  updatedAt: Date | null;
}

export interface VerifyResult {
  ok: true;
  verifiedForSec: number;
}

// Бизнес-логика PIN родителя. Сам PinService (в auth) отвечает за argon2 +
// Redis rate-limit/marker; здесь — проверка текущего состояния, смена,
// удаление (с каскадным сбросом protectionEnabled для всех детей).
@Injectable()
export class UserPinService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PinService) private readonly pin: PinService,
  ) {}

  async getStatus(userId: string): Promise<PinStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinHash: true, pinUpdatedAt: true },
    });
    if (!user) throw new UnauthorizedException({ code: 'unauthorized' });
    return { isSet: Boolean(user.pinHash), updatedAt: user.pinUpdatedAt };
  }

  // Установка/смена PIN. currentPin обязателен если PIN уже установлен.
  async setPin(userId: string, newPin: string, currentPin?: string): Promise<PinStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinHash: true },
    });
    if (!user) throw new UnauthorizedException({ code: 'unauthorized' });

    if (user.pinHash) {
      if (!currentPin) {
        throw new BadRequestException({
          code: 'current_pin_required',
          message: 'currentPin is required when PIN is already set',
        });
      }
      await this.assertPinMatches(userId, user.pinHash, currentPin);
    }

    const pinHash = await this.pin.hash(newPin);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash, pinUpdatedAt: new Date() },
      select: { pinUpdatedAt: true },
    });
    // Успешная смена — сбрасываем счётчик неудач и «свежесть» предыдущей
    // верификации (новый PIN — новое подтверждение).
    await this.pin.clearFailures(userId);
    await this.pin.clearVerified(userId);
    return { isSet: true, updatedAt: updated.pinUpdatedAt };
  }

  // Верификация PIN. При успехе ставит verified-marker в Redis
  // (короткий TTL), чтобы клиент мог дёрнуть PATCH /children/:id/protection
  // без повторного ввода.
  async verifyPin(userId: string, pin: string): Promise<VerifyResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinHash: true },
    });
    if (!user) throw new UnauthorizedException({ code: 'unauthorized' });
    if (!user.pinHash) {
      throw new BadRequestException({ code: 'pin_not_set', message: 'PIN is not set' });
    }
    await this.assertPinMatches(userId, user.pinHash, pin);
    await this.pin.markVerified(userId);
    // verifyTtlSec внутри pin.service — наружу отдаём эффективное окно.
    // Значение дублируется из конфига: клиент использует его для UI-таймера.
    const ttl = Number(process.env.PIN_VERIFY_TTL_SECONDS ?? 300);
    return { ok: true, verifiedForSec: ttl };
  }

  // Полное удаление PIN. Требует currentPin. Каскадно выключает
  // protectionEnabled для всех детей в семьях пользователя — без PIN защита
  // бессмысленна (нечем деактивировать Device Admin у ребёнка).
  async deletePin(userId: string, currentPin: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinHash: true },
    });
    if (!user) throw new UnauthorizedException({ code: 'unauthorized' });
    if (!user.pinHash) {
      throw new BadRequestException({ code: 'pin_not_set', message: 'PIN is not set' });
    }
    await this.assertPinMatches(userId, user.pinHash, currentPin);

    const familyIds = (
      await this.prisma.membership.findMany({
        where: { userId },
        select: { familyId: true },
      })
    ).map((m) => m.familyId);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { pinHash: null, pinUpdatedAt: null },
      }),
      this.prisma.child.updateMany({
        where: {
          familyId: { in: familyIds },
          protectionEnabled: true,
        },
        data: {
          protectionEnabled: false,
          protectionEnabledAt: null,
          protectionEnabledBy: null,
        },
      }),
    ]);
    await this.pin.clearFailures(userId);
    await this.pin.clearVerified(userId);
  }

  // Общий код для verify/setPin/deletePin: проверка PIN + обработка
  // lock-состояния Redis. Возвращает void при успехе, иначе бросает.
  private async assertPinMatches(userId: string, storedHash: string, plain: string): Promise<void> {
    const lock = await this.pin.isLocked(userId);
    if (lock.locked) {
      throw new HttpException(
        {
          code: 'pin_locked',
          message: 'Too many failed attempts, try later',
          retryAfterSec: lock.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const ok = await this.pin.verify(storedHash, plain);
    if (!ok) {
      const status = await this.pin.recordFailure(userId);
      throw new HttpException(
        {
          code: status.locked ? 'pin_locked' : 'invalid_pin',
          message: status.locked ? 'Too many failed attempts, try later' : 'Invalid PIN',
          retryAfterSec: status.retryAfterSec,
        },
        status.locked ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
