import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentRequiredGuard } from '../consent/guards/consent-required.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { FamilyMembersService } from './family-members.service';

/** v0.71.0: docs/superpowers/specs/2026-10-08-family-members.md */

const AcceptSchema = z.object({ code: z.string().min(1).max(32) }).strict();
const TransferSchema = z.object({ userId: z.string().min(1).max(64) }).strict();

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string };
}

@Controller('family')
@UseGuards(JwtAuthGuard)
export class FamilyMembersController {
  constructor(@Inject(FamilyMembersService) private readonly svc: FamilyMembersService) {}

  @Get('members')
  async members(@Req() req: AuthedRequest) {
    return this.svc.listMembers(req.user.userId);
  }

  @Delete('members/:userId')
  @HttpCode(204)
  @UseGuards(ConsentRequiredGuard)
  async remove(@Req() req: AuthedRequest, @Param('userId') userId: string): Promise<void> {
    await this.svc.removeMember(req.user.userId, userId);
  }

  @Post('leave')
  @HttpCode(200)
  async leave(@Req() req: AuthedRequest) {
    return this.svc.leave(req.user.userId);
  }

  @Post('transfer-ownership')
  @HttpCode(204)
  @UseGuards(ConsentRequiredGuard)
  async transfer(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(TransferSchema)) dto: z.infer<typeof TransferSchema>,
  ): Promise<void> {
    await this.svc.transferOwnership(req.user.userId, dto.userId);
  }

  @Post('member-invites')
  @UseGuards(ConsentRequiredGuard)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  async createInvite(@Req() req: AuthedRequest) {
    return { invite: await this.svc.createInvite(req.user.userId) };
  }

  @Get('member-invites')
  async listInvites(@Req() req: AuthedRequest) {
    return { invites: await this.svc.listInvites(req.user.userId) };
  }

  // Статические пути объявлены до `:id`, чтобы preview/accept не попали в него.
  @Get('member-invites/preview')
  @Throttle({ default: { ttl: 600_000, limit: 30 } })
  async preview(@Req() req: AuthedRequest, @Query('code') code?: string) {
    return this.svc.previewInvite(req.user.userId, code ?? '');
  }

  @Post('member-invites/accept')
  @HttpCode(200)
  @UseGuards(ConsentRequiredGuard)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  async accept(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(AcceptSchema)) dto: z.infer<typeof AcceptSchema>,
  ) {
    return this.svc.acceptInvite(req.user.userId, dto.code);
  }

  @Delete('member-invites/:id')
  @HttpCode(204)
  async revokeInvite(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.svc.revokeInvite(req.user.userId, id);
  }
}
