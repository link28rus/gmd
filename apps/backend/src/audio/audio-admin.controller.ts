import { Body, Controller, Get, Inject, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AppSettingsService, SETTINGS_KEYS } from '../app-settings/app-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAudioSettingsSchema, type UpdateAudioSettingsDto } from './dto/audio.dto';

interface AdminRequest extends Request {
  user: { userId: string; email?: string };
}

interface AudioSettingsView {
  defaultDurationSec: number;
  maxDurationSec: number;
  minDurationSec: number;
  hiddenModeAllowed: boolean;
  childReadyTimeoutSec: number;
}

interface AudioSessionListItem {
  id: string;
  childId: string;
  childName: string;
  familyId: string;
  requestedById: string;
  requestedByEmail: string;
  state: string;
  hiddenMode: boolean;
  durationSec: number;
  actualSec: number | null;
  failureReason: string | null;
  startedAt: string;
  endedAt: string | null;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AudioAdminController {
  constructor(
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('settings/audio')
  async getSettings(): Promise<AudioSettingsView> {
    return {
      defaultDurationSec: await this.settings.getNumber(
        SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC,
        300,
      ),
      maxDurationSec: await this.settings.getNumber(SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC, 1800),
      minDurationSec: await this.settings.getNumber(SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC, 30),
      hiddenModeAllowed: await this.settings.getBool(SETTINGS_KEYS.AUDIO_HIDDEN_MODE_ALLOWED, true),
      childReadyTimeoutSec: await this.settings.getNumber(
        SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC,
        45,
      ),
    };
  }

  @Patch('settings/audio')
  async updateSettings(
    @Req() req: AdminRequest,
    @Body(new ZodValidationPipe(UpdateAudioSettingsSchema)) dto: UpdateAudioSettingsDto,
  ): Promise<AudioSettingsView> {
    const updates: Array<[string, string]> = [];
    if (dto.defaultDurationSec !== undefined) {
      updates.push([SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, String(dto.defaultDurationSec)]);
    }
    if (dto.maxDurationSec !== undefined) {
      updates.push([SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC, String(dto.maxDurationSec)]);
    }
    if (dto.minDurationSec !== undefined) {
      updates.push([SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC, String(dto.minDurationSec)]);
    }
    if (dto.hiddenModeAllowed !== undefined) {
      updates.push([SETTINGS_KEYS.AUDIO_HIDDEN_MODE_ALLOWED, String(dto.hiddenModeAllowed)]);
    }
    if (dto.childReadyTimeoutSec !== undefined) {
      updates.push([SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC, String(dto.childReadyTimeoutSec)]);
    }

    for (const [k, v] of updates) {
      await this.settings.update(k, v, req.user.userId);
    }
    return this.getSettings();
  }

  /**
   * Список сессий для аудита. cursor-pagination через id.
   */
  @Get('audio/sessions')
  async listSessions(
    @Query('limit') limitQ = '50',
    @Query('cursor') cursor?: string,
  ): Promise<{ items: AudioSessionListItem[]; nextCursor?: string }> {
    const take = Math.min(Math.max(Number(limitQ) || 50, 1), 200);
    const rows = await this.prisma.audioSession.findMany({
      take: take + 1,
      orderBy: { startedAt: 'desc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        child: { select: { id: true, name: true, familyId: true } },
        requestedBy: { select: { id: true, email: true } },
      },
    });
    const hasMore = rows.length > take;
    const items: AudioSessionListItem[] = rows.slice(0, take).map((r) => ({
      id: r.id,
      childId: r.childId,
      childName: r.child.name,
      familyId: r.child.familyId,
      requestedById: r.requestedById,
      requestedByEmail: r.requestedBy.email,
      state: r.state,
      hiddenMode: r.hiddenMode,
      durationSec: r.durationSec,
      actualSec: r.actualSec,
      failureReason: r.failureReason,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    }));
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : undefined,
    };
  }
}
