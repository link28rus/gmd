import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { UserPinService } from './user-pin.service';
import type { PinStatus, VerifyResult } from './user-pin.service';

// PIN — 4-8 цифр. Короче 4 — небезопасно, длиннее 8 — UX-пытка на системном
// диалоге Android Device Admin. Разрешаем только digits чтобы не путать
// ребёнка на системном цифровом keypad.
const PinValue = z.string().regex(/^\d{4,8}$/, { message: 'PIN must be 4-8 digits' });

const SetPinSchema = z
  .object({
    currentPin: PinValue.optional(),
    newPin: PinValue,
  })
  .strict();

const VerifyPinSchema = z
  .object({
    pin: PinValue,
  })
  .strict();

const DeletePinSchema = z
  .object({
    currentPin: PinValue,
  })
  .strict();

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('me/pin')
@UseGuards(JwtAuthGuard)
export class UserPinController {
  constructor(@Inject(UserPinService) private readonly pin: UserPinService) {}

  @Get('status')
  async status(@Req() req: AuthedRequest): Promise<PinStatus> {
    return this.pin.getStatus(req.user.userId);
  }

  @Post()
  async set(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(SetPinSchema)) dto: z.infer<typeof SetPinSchema>,
  ): Promise<PinStatus> {
    return this.pin.setPin(req.user.userId, dto.newPin, dto.currentPin);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(VerifyPinSchema)) dto: z.infer<typeof VerifyPinSchema>,
  ): Promise<VerifyResult> {
    return this.pin.verifyPin(req.user.userId, dto.pin);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(DeletePinSchema)) dto: z.infer<typeof DeletePinSchema>,
  ): Promise<void> {
    await this.pin.deletePin(req.user.userId, dto.currentPin);
  }
}
