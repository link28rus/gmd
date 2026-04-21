import {
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentRequiredGuard } from '../consent/guards/consent-required.guard';
import { DeviceCommandsService } from './device-commands.service';

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('family/children/:childId/commands')
@UseGuards(JwtAuthGuard)
export class ParentCommandsController {
  constructor(@Inject(DeviceCommandsService) private readonly svc: DeviceCommandsService) {}

  // Лимит: 6 сигналов в минуту на родителя — на случай истерики или бага
  // в UI. Защищает ребёнка от бесконечного воя.
  @Post('signal')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ConsentRequiredGuard)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async sendSignal(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
  ): Promise<{ commandId: string; expiresAt: string }> {
    return this.svc.sendSignal(req.user.familyId, childId, req.user.userId);
  }
}
