import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('me')
  async me(@Req() req: AuthedRequest): Promise<unknown> {
    return this.users.getMe(req.user.userId, req.user.familyId);
  }

  @Patch('me')
  async update(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(UpdateMeSchema)) dto: z.infer<typeof UpdateMeSchema>,
  ): Promise<{ user: unknown }> {
    const user = await this.users.updateMe(req.user.userId, dto);
    return { user };
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthedRequest): Promise<void> {
    await this.users.softDelete(req.user.userId);
  }
}
