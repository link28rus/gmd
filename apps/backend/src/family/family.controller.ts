import { Body, Controller, Inject, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { FamilyService } from './family.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';

const PatchFamilySchema = z.object({ name: z.string().min(1).max(120) }).strict();

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('family')
@UseGuards(JwtAuthGuard)
export class FamilyController {
  constructor(@Inject(FamilyService) private readonly family: FamilyService) {}

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchFamilySchema)) dto: z.infer<typeof PatchFamilySchema>,
    @Req() req: AuthedRequest,
  ): Promise<{ family: { id: string; name: string } }> {
    const family = await this.family.rename(req.user.userId, id, dto.name);
    return { family };
  }
}
