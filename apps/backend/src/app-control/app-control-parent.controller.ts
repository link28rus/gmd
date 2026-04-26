import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AppControlService } from './app-control.service';

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
