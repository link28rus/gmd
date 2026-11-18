import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hashDeviceToken } from '../child-device/child-device.service';
import { AppBlockingService } from './app-blocking.service';
import { ScheduleService } from './schedule.service';
import type { AppControlAck } from './dto/app-control-state.dto';
import { PermissionsSchema, PERMISSION_STALE_MS } from '../permission-state/permission-state';

export function configRevision(binding: string, state: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([binding, state]))
    .digest('hex');
}

const policyDeviceSelect = {
  id: true,
  childId: true,
  child: { select: { familyId: true } },
} as const;
type PolicyDevice = { id: string; childId: string; child: { familyId: string } };

@Injectable()
export class AppControlSyncService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppBlockingService) private readonly blocking: AppBlockingService,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
  ) {}

  private async snapshot({ id: deviceId, childId, child }: PolicyDevice) {
    const [session, rules, schedules, blockingZones] = await Promise.all([
      this.blocking.getActiveSessionByDevice(deviceId),
      this.blocking.listEffectiveRules(deviceId),
      this.schedules.listForDevice(deviceId),
      this.prisma.zone.findMany({
        where: {
          familyId: child.familyId,
          deletedAt: null,
          blockApps: true,
          OR: [{ allChildren: true }, { assignments: { some: { childId } } }],
        },
        select: { id: true, name: true, centerLat: true, centerLon: true, radius: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      session: session ? { sessionId: session.id, endsAt: session.endsAt.toISOString() } : null,
      rules: [...rules].sort((a, b) => a.packageName.localeCompare(b.packageName)),
      schedules: schedules
        .map((s) => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          daysMask: s.daysMask,
          startMin: s.startMin,
          endMin: s.endMin,
          mode: s.mode,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      // Пустой список сохраняет revision существующей конфигурации.
      ...(blockingZones.length ? { blockingZones } : {}),
    };
  }

  async get(deviceId: string, token: string) {
    const bindingHash = hashDeviceToken(token);
    const device = await this.prisma.childDevice.findFirst({
      where: { id: deviceId, tokenHash: bindingHash, revokedAt: null },
      select: policyDeviceSelect,
    });
    if (!device) throw new UnauthorizedException({ code: 'unauthorized' });
    const state = await this.snapshot(device);
    return {
      ...state,
      blockingZones: state.blockingZones ?? [],
      revision: configRevision(bindingHash, state),
      serverNow: new Date().toISOString(),
    };
  }

  async ack(deviceId: string, token: string, ack: AppControlAck) {
    const bindingHash = hashDeviceToken(token);
    // CAS по привязке: старый запрос не обновляет новый телефон после claim.
    const result = await this.prisma.childDevice.updateMany({
      where: { id: deviceId, tokenHash: bindingHash, revokedAt: null },
      data: {
        timezone: ack.timezone,
        appControlStatus: { ...ack, bindingHash, receivedAt: new Date().toISOString() },
      },
    });
    if (!result.count) throw new UnauthorizedException({ code: 'unauthorized' });
  }

  async status(childId: string) {
    const device = await this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
      select: {
        ...policyDeviceSelect,
        tokenHash: true,
        timezone: true,
        appControlStatus: true,
        usageReportedAt: true,
        permissionState: true,
      },
    });
    if (!device) throw new NotFoundException({ code: 'no_active_device' });
    const state = await this.snapshot(device);
    const raw = device.appControlStatus;
    const ack =
      raw && typeof raw === 'object' && !Array.isArray(raw) && raw.bindingHash === device.tokenHash
        ? raw
        : null;
    const reportedAt = typeof ack?.receivedAt === 'string' ? ack.receivedAt : null;
    const fresh = reportedAt !== null && Date.now() - Date.parse(reportedAt) < 60 * 60_000;
    const permissionState = device.permissionState;
    const permissions =
      permissionState?.bindingHash === device.tokenHash &&
      Date.now() - permissionState.reportedAt.getTime() < PERMISSION_STALE_MS
        ? PermissionsSchema.safeParse(permissionState.permissions)
        : null;
    // Более новый отчёт об отзыве разрешения немедленно снимает зелёное подтверждение.
    const accessibility =
      permissions?.success && permissions.data.accessibility === false
        ? false
        : typeof ack?.accessibility === 'boolean'
          ? ack.accessibility
          : null;
    return {
      timezone: device.timezone,
      reportedAt,
      usageReportedAt: device.usageReportedAt,
      accessibility,
      usageStats: typeof ack?.usageStats === 'boolean' ? ack.usageStats : null,
      applied: Boolean(
        fresh &&
        accessibility === true &&
        (!state.blockingZones || ack?.zoneBlockingSupported === true) &&
        ack?.revision === configRevision(device.tokenHash, state),
      ),
    };
  }
}
