import { Body, Controller, Get, Inject, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { FamilyService, type SosEventDto } from './family.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentRequiredGuard } from '../consent/guards/consent-required.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';

const PatchFamilySchema = z.object({ name: z.string().min(1).max(120) }).strict();

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('family')
@UseGuards(JwtAuthGuard)
export class FamilyController {
  constructor(@Inject(FamilyService) private readonly family: FamilyService) {}

  @Get('sos')
  async listSos(
    @Req() req: AuthedRequest,
    @Query('since') since?: string,
  ): Promise<{ events: SosEventDto[] }> {
    return this.family.listFamilySos(req.user.userId, since ? new Date(since) : undefined);
  }

  @Patch(':id')
  @UseGuards(ConsentRequiredGuard)
  async rename(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchFamilySchema)) dto: z.infer<typeof PatchFamilySchema>,
    @Req() req: AuthedRequest,
  ): Promise<{ family: { id: string; name: string } }> {
    const family = await this.family.rename(req.user.userId, id, dto.name);
    return { family };
  }
}
