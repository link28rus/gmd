import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChildrenService } from './children.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { CreateChildSchema } from './dto/create-child.dto';
import type { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildSchema } from './dto/update-child.dto';
import type { UpdateChildDto } from './dto/update-child.dto';

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('family/children')
@UseGuards(JwtAuthGuard)
export class ChildrenController {
  constructor(@Inject(ChildrenService) private readonly children: ChildrenService) {}

  @Get()
  async list(@Req() req: AuthedRequest): Promise<{ children: unknown[] }> {
    const list = await this.children.listChildren(req.user.familyId);
    return {
      children: list.map((c) => ({
        id: c.id,
        name: c.name,
        dateOfBirth: c.dateOfBirth,
        device: c.device
          ? {
              id: c.device.id,
              deviceName: c.device.deviceName,
              osVersion: c.device.osVersion,
              appVersion: c.device.appVersion,
              lastSeenAt: c.device.lastSeenAt,
              revokedAt: c.device.revokedAt,
            }
          : null,
      })),
    };
  }

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateChildSchema)) dto: CreateChildDto,
  ): Promise<{ child: unknown }> {
    const c = await this.children.createChild(req.user.familyId, dto);
    return {
      child: { id: c.id, name: c.name, dateOfBirth: c.dateOfBirth, createdAt: c.createdAt },
    };
  }

  @Patch(':childId')
  async patch(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Body(new ZodValidationPipe(UpdateChildSchema)) dto: UpdateChildDto,
  ): Promise<{ child: unknown }> {
    const c = await this.children.updateChild(req.user.familyId, childId, dto);
    return { child: { id: c.id, name: c.name, dateOfBirth: c.dateOfBirth } };
  }

  @Delete(':childId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthedRequest, @Param('childId') childId: string): Promise<void> {
    await this.children.softDelete(req.user.familyId, childId);
  }
}
