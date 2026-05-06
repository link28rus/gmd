import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AppControlService } from './app-control.service';
import { AppBlockingService } from './app-blocking.service';
import { ScheduleService } from './schedule.service';
import { CreateBlockSessionSchema, type CreateBlockSessionBody } from './dto/block-session.dto';
import { PutAppRuleSchema, type PutAppRuleBody } from './dto/app-rule.dto';
import {
  CreateScheduleSchema,
  UpdateScheduleSchema,
  formatHHMM,
  type AppBlockScheduleDto,
  type CreateScheduleBody,
  type UpdateScheduleBody,
} from './dto/schedule.dto';
import type { AppBlockSchedule } from '@prisma/client';

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' | 'admin' };
}

/**
 * Endpoints для UI парента (web-кабинет, mobile-parent).
 * Защищены JwtAuthGuard. Перед каждым вызовом проверяем что childId
 * принадлежит familyId родителя — иначе 403.
 */
@Controller('family/children/:childId/app-control')
@UseGuards(JwtAuthGuard)
export class AppControlParentController {
  constructor(
    @Inject(AppControlService) private readonly svc: AppControlService,
    @Inject(AppBlockingService) private readonly blocking: AppBlockingService,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('installed-apps')
  async installedApps(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
  ): Promise<{ apps: unknown[] }> {
    await this.assertChildInFamily(req.user.familyId, childId);
    const baseUrl = this.computeBaseUrl(req);
    const apps = await this.svc.listInstalledApps(childId, baseUrl);
    return { apps };
  }

  @Get('usage')
  async usage(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Query('range') rangeRaw?: string,
    @Query('date') date?: string,
  ): Promise<unknown> {
    await this.assertChildInFamily(req.user.familyId, childId);
    const range = rangeRaw === 'week' ? 'week' : 'day';
    if (range === 'week' && date) {
      // weekly агрегации идут от end-date — допустимо.
    }
    const result = await this.svc.getUsage(childId, range, date ?? null);
    return { range, result };
  }

  // ─── Phase 6.2 (v0.39): App Blocking ────────────────────────────────────

  /**
   * Создать BlockSession (родитель нажал «Заблокировать на N минут»).
   * 201 + {sessionId, startedAt, endsAt}.
   * 409 session_already_active — для child уже есть ACTIVE сессия.
   * 404 no_active_device — у ребёнка нет привязанного устройства.
   */
  @Post('block-sessions')
  @HttpCode(HttpStatus.CREATED)
  async createBlockSession(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Body(new ZodValidationPipe(CreateBlockSessionSchema)) dto: CreateBlockSessionBody,
  ): Promise<{ sessionId: string; startedAt: string; endsAt: string }> {
    await this.assertChildInFamily(req.user.familyId, childId);
    const result = await this.blocking.createSession({
      childId,
      createdByUserId: req.user.userId,
      durationMin: dto.durationMin,
    });
    return {
      sessionId: result.sessionId,
      startedAt: result.startedAt.toISOString(),
      endsAt: result.endsAt.toISOString(),
    };
  }

  /**
   * Текущая активная сессия для child. 200 + payload | 204 если нет.
   */
  @Get('block-sessions/active')
  async activeBlockSession(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
  ): Promise<{ sessionId: string; startedAt: string; endsAt: string } | null> {
    await this.assertChildInFamily(req.user.familyId, childId);
    const session = await this.blocking.getActiveSession(childId);
    if (!session) return null;
    return {
      sessionId: session.id,
      startedAt: session.startedAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
    };
  }

  /**
   * Завершить активную сессию (родитель нажал «Снять блок»).
   * 204. Идемпотентно для уже ENDED/EXPIRED сессий.
   */
  @Delete('block-sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async stopBlockSession(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await this.assertChildInFamily(req.user.familyId, childId);
    await this.blocking.stopSession({
      childId,
      sessionId,
      stoppedByUserId: req.user.userId,
    });
  }

  /**
   * Список явно сохранённых правил (PARENT + SYSTEM_DEFAULT). HARDCODED не
   * включаем — UI знает их статически. Frontend комбинирует этот ответ со
   * списком installed-apps.
   */
  @Get('app-rules')
  async listAppRules(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
  ): Promise<{ rules: Array<{ packageName: string; mode: string; source: string }> }> {
    await this.assertChildInFamily(req.user.familyId, childId);
    const device = await this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
      select: { id: true },
    });
    if (!device) return { rules: [] };
    const rules = await this.blocking.listParentRules(device.id);
    return { rules };
  }

  /**
   * Установить правило для конкретного packageName.
   * 200 + сохранённое правило.
   */
  @Put('app-rules/:packageName')
  async putAppRule(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Param('packageName') packageName: string,
    @Body(new ZodValidationPipe(PutAppRuleSchema)) dto: PutAppRuleBody,
  ): Promise<{ packageName: string; mode: string; source: string }> {
    await this.assertChildInFamily(req.user.familyId, childId);
    if (!packageName || packageName.length > 255) {
      throw new BadRequestException({
        code: 'invalid_package_name',
        message: 'packageName required (max 255 chars)',
      });
    }
    const rule = await this.blocking.upsertParentRule({
      childId,
      packageName,
      mode: dto.mode,
    });
    return { packageName: rule.packageName, mode: rule.mode, source: rule.source };
  }

  // ─── Phase 6.x (v0.48): App Block Schedules ─────────────────────────────

  /**
   * Список расписаний автоблокировки для ребёнка.
   * 200 + {schedules: AppBlockScheduleDto[]}. Пустой список если устройства нет.
   */
  @Get('schedules')
  async listSchedules(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
  ): Promise<{ schedules: AppBlockScheduleDto[] }> {
    await this.assertChildInFamily(req.user.familyId, childId);
    const list = await this.schedules.listForChild(childId);
    return { schedules: list.map(toDto) };
  }

  /**
   * Создать новое расписание. 201 + созданный объект.
   * 403 schedule_limit_reached — превышен лимит на ребёнка (10).
   * 404 no_active_device — у ребёнка нет привязанного устройства.
   */
  @Post('schedules')
  @HttpCode(HttpStatus.CREATED)
  async createSchedule(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Body(new ZodValidationPipe(CreateScheduleSchema)) dto: CreateScheduleBody,
  ): Promise<AppBlockScheduleDto> {
    await this.assertChildInFamily(req.user.familyId, childId);
    const created = await this.schedules.createForChild({
      childId,
      createdByUserId: req.user.userId,
      body: dto,
    });
    return toDto(created);
  }

  /**
   * Частичный апдейт расписания (включая тумблер enabled).
   * 200 + обновлённый объект.
   */
  @Patch('schedules/:scheduleId')
  async updateSchedule(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Param('scheduleId') scheduleId: string,
    @Body(new ZodValidationPipe(UpdateScheduleSchema)) dto: UpdateScheduleBody,
  ): Promise<AppBlockScheduleDto> {
    await this.assertChildInFamily(req.user.familyId, childId);
    const updated = await this.schedules.updateForChild({ childId, scheduleId, body: dto });
    return toDto(updated);
  }

  /**
   * Удалить расписание. 204.
   */
  @Delete('schedules/:scheduleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSchedule(
    @Req() req: AuthedRequest,
    @Param('childId') childId: string,
    @Param('scheduleId') scheduleId: string,
  ): Promise<void> {
    await this.assertChildInFamily(req.user.familyId, childId);
    await this.schedules.deleteForChild({ childId, scheduleId });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async assertChildInFamily(familyId: string, childId: string): Promise<void> {
    if (!childId || typeof childId !== 'string') {
      throw new BadRequestException({ code: 'invalid_child_id', message: 'childId required' });
    }
    const child = await this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null },
      select: { id: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
  }

  private computeBaseUrl(req: Request): string {
    // Для генерации iconUrl. В prod за Caddy proxy — берём proto/host из X-Forwarded-*
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol ?? 'http';
    const host =
      (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? 'localhost';
    return `${proto}://${host}`;
  }
}

function toDto(s: AppBlockSchedule): AppBlockScheduleDto {
  return {
    id: s.id,
    name: s.name,
    enabled: s.enabled,
    daysMask: s.daysMask,
    startMin: s.startMin,
    endMin: s.endMin,
    startTime: formatHHMM(s.startMin),
    endTime: formatHHMM(s.endMin),
    crossesMidnight: s.startMin > s.endMin,
    mode: s.mode,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
