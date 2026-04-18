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
import { InvitesService } from './invites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('family/children/:childId')
@UseGuards(JwtAuthGuard)
export class InvitesController {
  constructor(@Inject(InvitesService) private readonly invites: InvitesService) {}

  @Post('invites')
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  async createInvite(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
  ): Promise<unknown> {
    return this.invites.createInvite(req.user.familyId, childId, req.user.userId);
  }

  @Post('reset-device')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  async resetDevice(@Req() req: AuthedRequest, @Param('childId') childId: string): Promise<void> {
    await this.invites.resetDevice(req.user.familyId, childId);
  }
}
