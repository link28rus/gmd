import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ChildDeviceService } from './child-device.service';
import type { ChildAuthContext } from './child-device.service';
import { ChildAuthGuard } from './guards/child-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ClaimSchema } from './dto/claim.dto';
import type { ClaimDto } from './dto/claim.dto';

const VerifyPinSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/) }).strict();

// v0.37: token может быть null если устройство только что сделало
// FirebaseInstanceId.delete() (но это рарити). Длина FCM token обычно
// 140-200 char; даём разумный max 4096 на всякий случай.
const FcmTokenSchema = z.object({ fcmToken: z.string().min(10).max(4096).nullable() }).strict();

// v0.38 escape hatch: child устройство периодически проверяет, валиден ли
// его device-token. Body `{deviceToken}` (а не header X-Child-Token, чтобы
// случайно не получить 401 от ChildAuthGuard вместо JSON-ответа).
// Token имеет фиксированную длину (cuid или secret) — даём разумный диапазон.
const AuthStatusSchema = z.object({ deviceToken: z.string().min(10).max(512) }).strict();

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

@Controller('child')
export class ChildDeviceController {
  constructor(@Inject(ChildDeviceService) private readonly svc: ChildDeviceService) {}

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  async claim(
    @Req() req: Request,
    @Body(new ZodValidationPipe(ClaimSchema)) dto: ClaimDto,
  ): Promise<unknown> {
    const started = Date.now();
    const ua = req.headers['user-agent'];
    try {
      return await this.svc.claim(dto.code, {
        deviceName: dto.deviceName,
        osVersion: dto.osVersion,
        appVersion: dto.appVersion,
        consent14Plus: dto.consent14Plus,
        ip: req.ip,
        ua: typeof ua === 'string' ? ua : undefined,
      });
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
    }
  }

  @Get('me')
  @UseGuards(ChildAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async me(@Req() req: ChildRequest): Promise<unknown> {
    return {
      child: {
        id: req.childDevice.childId,
        name: req.childDevice.childName,
        familyId: req.childDevice.familyId,
      },
      device: { id: req.childDevice.deviceId },
    };
  }

  // Ребёнок опрашивает protection-state с устройства по device-token
  // (без участия родителя в auth-flow). Если enabled=true и Device Admin
  // не активен — приложение показывает экран активации. Отдельно от
  // /family/children/:id/protection (который требует родительский JWT).
  @Get('protection')
  @UseGuards(ChildAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async protection(@Req() req: ChildRequest): Promise<{ enabled: boolean }> {
    return this.svc.getProtection(req.childDevice.childId);
  }

  // L2 PIN-lock: ребёнок в системном диалоге деактивации Device Admin вводит
  // PIN → AccessibilityService шлёт сюда. Rate-limit 10 попыток в 10 мин
  // (сверх внутреннего pin-lock). Ответ 200 {ok:true} = пускать, 401/429 = нет.
  @Post('protection/verify-pin')
  @UseGuards(ChildAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  async verifyProtectionPin(
    @Req() req: ChildRequest,
    @Body(new ZodValidationPipe(VerifyPinSchema)) dto: z.infer<typeof VerifyPinSchema>,
  ): Promise<{ ok: true }> {
    return this.svc.verifyParentPin({
      deviceId: req.childDevice.deviceId,
      childId: req.childDevice.childId,
      familyId: req.childDevice.familyId,
      pin: dto.pin,
    });
  }

  // v0.38: escape hatch probe — без auth guard, токен в теле.
  // Возвращает 200 c {status: 'active' | 'device_revoked' | 'child_deleted' | 'unknown'}.
  // Mobile-child вызывает раз в час и при каждом 401, чтобы понять — нужно ли
  // делать self-destruct (removeActiveAdmin + clear creds) или это network blip.
  //
  // Throttle жёсткий: 6/мин с одного IP — не позволяем enumerate.
  // 200 OK даже для 'unknown' (а не 404) — ровно один тип ответа, чтобы
  // attacker по статусам не мог понять, существовал ли token раньше.
  @Post('auth-status')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async authStatus(
    @Body(new ZodValidationPipe(AuthStatusSchema)) dto: z.infer<typeof AuthStatusSchema>,
  ): Promise<{ status: 'active' | 'device_revoked' | 'child_deleted' | 'unknown' }> {
    return this.svc.getAuthStatus(dto.deviceToken);
  }

  // v0.37: child регистрирует FCM token при старте app + onTokenRefresh.
  // Используется для high-priority push доставки команд (мгновенный START_AUDIO).
  // Throttle мягкий (10/мин) — token меняется редко, но retry на ошибках OK.
  @Post('devices/fcm-token')
  @UseGuards(ChildAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async setFcmToken(
    @Req() req: ChildRequest,
    @Body(new ZodValidationPipe(FcmTokenSchema)) dto: z.infer<typeof FcmTokenSchema>,
  ): Promise<void> {
    await this.svc.setFcmToken(req.childDevice.deviceId, dto.fcmToken);
  }
}
