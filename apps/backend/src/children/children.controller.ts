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
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ChildrenService } from './children.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentRequiredGuard } from '../consent/guards/consent-required.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { CreateChildSchema } from './dto/create-child.dto';
import type { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildSchema } from './dto/update-child.dto';
import type { UpdateChildDto } from './dto/update-child.dto';

const UpdateProtectionSchema = z.object({ enabled: z.boolean() }).strict();

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
        avatarKey: c.avatarKey,
        protectionEnabled: c.protectionEnabled,
        protectionEnabledAt: c.protectionEnabledAt,
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
  @UseGuards(ConsentRequiredGuard)
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
  @UseGuards(ConsentRequiredGuard)
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
  @UseGuards(ConsentRequiredGuard)
  async remove(@Req() req: AuthedRequest, @Param('childId') childId: string): Promise<void> {
    await this.children.softDelete(req.user.familyId, childId);
  }

  // Отвязать устройство ребёнка, не удаляя самого ребёнка. Отзывает активный
  // device-token и гасит неиспользованные invites; ребёнок остаётся в списке
  // и может быть привязан заново по новому QR. Consent не требуется — это
  // уменьшение объёма обрабатываемых данных, а не новая обработка.
  @Delete(':childId/device')
  @HttpCode(HttpStatus.OK)
  async unbindDevice(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
  ): Promise<{ unbound: boolean }> {
    return this.children.unbindDevice(req.user.familyId, childId);
  }

  // Аватар ребёнка (v0.61, docs/superpowers/specs/2026-09-29-child-avatars.md).
  // Тело валидирует сервис: ошибки — `invalid_avatar` (400) / `avatar_too_large` (413).
  @Put(':childId/avatar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConsentRequiredGuard)
  async setAvatar(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Body() body: unknown,
  ): Promise<{ avatarKey: string }> {
    return this.children.setAvatar(req.user.familyId, childId, body);
  }

  // Убрать аватар (вернуть букву). Consent не требуется — это удаление ПДн,
  // а не новая обработка (как и отвязка устройства).
  @Delete(':childId/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAvatar(@Req() req: AuthedRequest, @Param('childId') childId: string): Promise<void> {
    await this.children.removeAvatar(req.user.familyId, childId);
  }

  // Байты фото — ПДн, только под JWT родителя этой семьи; `private` — не для общих кэшей.
  @Get(':childId/avatar')
  async getAvatar(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Res() res: Response,
  ): Promise<void> {
    const photo = await this.children.getAvatarPhoto(req.user.familyId, childId);
    res.set({
      'Content-Type': photo.mime,
      'Cache-Control': 'private, max-age=86400',
      ETag: `"${photo.sha256}"`,
    });
    res.send(photo.data);
  }

  @Get(':childId/protection')
  async getProtection(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
  ): Promise<unknown> {
    return this.children.getProtection(req.user.familyId, childId);
  }

  @Patch(':childId/protection')
  async setProtection(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Body(new ZodValidationPipe(UpdateProtectionSchema))
    dto: z.infer<typeof UpdateProtectionSchema>,
  ): Promise<unknown> {
    return this.children.setProtection(req.user.familyId, childId, dto.enabled, req.user.userId);
  }
}
