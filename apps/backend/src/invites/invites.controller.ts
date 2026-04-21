import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { InvitesService } from './invites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentRequiredGuard } from '../consent/guards/consent-required.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';

const CreateInviteSchema = z
  .object({
    // Для детей 14+: родитель подтверждает, что получил согласие ребёнка
    // на обработку геолокации. Обязательно true, если ребёнок старше 14 лет,
    // иначе claim упадёт с consent14plus_required.
    consent14PlusGranted: z.boolean().optional(),
  })
  .optional()
  .transform((v) => v ?? {});
type CreateInviteDto = z.infer<typeof CreateInviteSchema>;

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('family/children/:childId')
@UseGuards(JwtAuthGuard)
export class InvitesController {
  constructor(@Inject(InvitesService) private readonly invites: InvitesService) {}

  @Post('invites')
  @UseGuards(ConsentRequiredGuard)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  async createInvite(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Body(new ZodValidationPipe(CreateInviteSchema)) body: CreateInviteDto,
  ): Promise<unknown> {
    return this.invites.createInvite(req.user.familyId, childId, req.user.userId, {
      consent14PlusGranted: body.consent14PlusGranted === true,
    });
  }

  @Post('reset-device')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ConsentRequiredGuard)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  async resetDevice(@Req() req: AuthedRequest, @Param('childId') childId: string): Promise<void> {
    await this.invites.resetDevice(req.user.familyId, childId);
  }
}
