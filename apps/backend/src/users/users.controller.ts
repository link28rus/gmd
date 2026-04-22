import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentRequiredGuard } from '../consent/guards/consent-required.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';

const UpdateMeSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    locale: z.string().length(2).optional(),
  })
  .strict();

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class UsersController {
  /**
   * Heartbeat из кабинета приходит довольно часто (раз в минуту), поэтому
   * держим дешёвый in-memory throttle: не пишем в БД чаще, чем раз в минуту
   * на один JWT. На несколько реплик этот троттл не защищает БД от суммарной
   * нагрузки, но при реальном трафике разница в пару UPDATE'ов в минуту —
   * пренебрежимо мала. Более сложный распределённый троттл потратил бы
   * время без пропорциональной пользы.
   */
  private static readonly SEEN_THROTTLE_MS = 60_000;
  private seenThrottle = new Map<string, number>();

  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get('me')
  async me(@Req() req: AuthedRequest): Promise<unknown> {
    return this.users.getMe(req.user.userId, req.user.familyId);
  }

  @Patch('me')
  @UseGuards(ConsentRequiredGuard)
  async update(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(UpdateMeSchema)) dto: z.infer<typeof UpdateMeSchema>,
  ): Promise<{ user: unknown }> {
    const user = await this.users.updateMe(req.user.userId, dto);
    return { user };
  }

  @Post('me/seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  async seen(@Req() req: AuthedRequest): Promise<void> {
    const userId = req.user.userId;
    const lastWrite = this.seenThrottle.get(userId) ?? 0;
    const now = Date.now();
    if (now - lastWrite < UsersController.SEEN_THROTTLE_MS) return;
    this.seenThrottle.set(userId, now);
    await this.auth.touchLastSeen(userId);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthedRequest): Promise<void> {
    await this.users.softDelete(req.user.userId);
  }
}
