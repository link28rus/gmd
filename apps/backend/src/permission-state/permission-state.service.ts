import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import { ParentDevicesService } from '../parent-devices/parent-devices.service';
import { hashDeviceToken } from '../child-device/child-device.service';
import {
  degradedPermissions,
  permissionView,
  PermissionsSchema,
  PERMISSION_LABELS,
} from './permission-state';
import type { PermissionKey, PermissionReport } from './permission-state';

@Injectable()
export class PermissionStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionStateService.name);
  private timer?: ReturnType<typeof setInterval>;
  private flushing = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FcmService) private readonly fcm: FcmService,
    @Inject(ParentDevicesService) private readonly parents: ParentDevicesService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') {
      this.timer = setInterval(() => {
        void this.flush().catch((e) => this.logger.warn(String(e)));
      }, 60_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async report(deviceId: string, token: string, report: PermissionReport) {
    const bindingHash = hashDeviceToken(token);
    await this.prisma.$transaction(async (tx) => {
      // Блокировка совпадает со строкой, обновляемой claim/unbind: отозванный
      // после auth-guard запрос не перезапишет состояние нового телефона.
      await tx.$queryRaw`SELECT id FROM child_devices WHERE id = ${deviceId} FOR UPDATE`;
      const device = await tx.childDevice.findFirst({
        where: {
          id: deviceId,
          tokenHash: bindingHash,
          revokedAt: null,
          child: { deletedAt: null, family: { deletedAt: null } },
        },
        include: { child: true, permissionState: true },
      });
      if (!device) throw new UnauthorizedException({ code: 'unauthorized' });
      const previous =
        device.permissionState?.bindingHash === bindingHash ? device.permissionState : null;
      if (previous && previous.sequence >= BigInt(report.sequence)) return;
      const before = previous
        ? PermissionsSchema.parse(previous.lastKnown ?? previous.permissions)
        : null;
      const lastKnown = Object.fromEntries(
        Object.entries(report.permissions).map(([key, value]) => [
          key,
          value ?? before?.[key as PermissionKey] ?? null,
        ]),
      );
      const degraded = degradedPermissions(before, report.permissions).filter(
        (k) => k !== 'deviceAdmin' || device.child.protectionEnabled,
      );
      await tx.childDevicePermissionState.upsert({
        where: { childDeviceId: deviceId },
        create: {
          childDeviceId: deviceId,
          bindingHash,
          sequence: BigInt(report.sequence),
          permissions: report.permissions,
          lastKnown,
        },
        update: {
          bindingHash,
          sequence: BigInt(report.sequence),
          permissions: report.permissions,
          lastKnown,
          reportedAt: new Date(),
        },
      });
      // Восстановление окончательно снимает старое событие, даже если его
      // retryAt ещё не наступил. Следующий отзыв создаст новое событие.
      const pending = await tx.permissionAlert.findMany({
        where: { childDeviceId: deviceId, completedAt: null },
      });
      for (const alert of pending) {
        const remaining = Array.isArray(alert.permissions)
          ? alert.permissions.filter(
              (k) =>
                typeof k === 'string' &&
                Object.hasOwn(PERMISSION_LABELS, k) &&
                report.permissions[k as PermissionKey] !== true &&
                (k !== 'deviceAdmin' || device.child.protectionEnabled),
            )
          : [];
        await tx.permissionAlert.updateMany({
          where: { id: alert.id, completedAt: null },
          data: {
            permissions: remaining,
            ...(alert.bindingHash !== bindingHash || remaining.length === 0
              ? { completedAt: new Date() }
              : {}),
          },
        });
      }
      if (degraded.length) {
        const memberships = await tx.membership.findMany({
          where: { familyId: device.child.familyId },
          select: { userId: true },
        });
        const targets = await tx.parentDevice.findMany({
          where: {
            userId: { in: memberships.map((m) => m.userId) },
            revokedAt: null,
            user: { deletedAt: null, blockedAt: null },
          },
          select: { id: true },
        });
        if (targets.length)
          await tx.permissionAlert.createMany({
            data: targets.map((p) => ({
              childDeviceId: deviceId,
              parentDeviceId: p.id,
              bindingHash,
              permissions: degraded,
            })),
          });
      }
    });
    // Сбой внешнего push не превращает успешно сохранённый отчёт в ошибку.
    await this.flush().catch((e) => this.logger.warn(`permission push: ${String(e)}`));
    return { accepted: true };
  }

  private async deviceInFamily(familyId: string, childId: string) {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null, family: { deletedAt: null } },
      include: { device: { include: { permissionState: true } } },
    });
    if (!child) throw new NotFoundException({ code: 'child_not_found' });
    return child;
  }

  async get(familyId: string, childId: string) {
    const child = await this.deviceInFamily(familyId, childId);
    const device = child.device;
    return permissionView(
      device && !device.revokedAt && device.permissionState?.bindingHash === device.tokenHash
        ? device.permissionState
        : null,
      new Date(),
      child.protectionEnabled,
    );
  }

  async refresh(familyId: string, childId: string) {
    const { device: d } = await this.deviceInFamily(familyId, childId);
    if (!d || d.revokedAt) return { requested: false };
    const requested = await this.fcm.sendHybridDataMessage(
      d.id,
      { fcmToken: d.fcmToken, rustorePushToken: d.rustorePushToken },
      { type: 'REPORT_PERMISSION_STATE' },
      // У детского RuStore data-handler пока только журналирование. Не
      // подтверждаем запрос через канал, который его не выполняет.
      { rustore: false },
    );
    return { requested };
  }

  /** Персистентная очередь per-device, lease предотвращает параллельную рассылку. */
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const now = new Date();
      const alerts = await this.prisma.permissionAlert.findMany({
        where: {
          completedAt: null,
          retryAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const alert of alerts) {
        const leaseUntil = new Date(Date.now() + 5 * 60_000);
        const claim = await this.prisma.permissionAlert.updateMany({
          where: {
            id: alert.id,
            completedAt: null,
            retryAt: { lte: now },
            OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
          },
          data: { leaseUntil },
        });
        if (!claim.count) continue;
        try {
          const d = await this.prisma.childDevice.findFirst({
            where: {
              id: alert.childDeviceId,
              tokenHash: alert.bindingHash,
              revokedAt: null,
              child: { deletedAt: null, family: { deletedAt: null } },
            },
            include: { child: true, permissionState: true },
          });
          const state = d?.permissionState
            ? PermissionsSchema.safeParse(
                d.permissionState.lastKnown ?? d.permissionState.permissions,
              )
            : null;
          const keys = Array.isArray(alert.permissions)
            ? alert.permissions.filter(
                (k): k is PermissionKey =>
                  typeof k === 'string' &&
                  Object.hasOwn(PERMISSION_LABELS, k) &&
                  state?.success === true &&
                  state.data[k as PermissionKey] === false &&
                  (k !== 'deviceAdmin' || d?.child.protectionEnabled === true),
              )
            : [];
          const p = d
            ? (await this.parents.findActiveByFamilyId(d.child.familyId)).find(
                (p) => p.id === alert.parentDeviceId,
              )
            : null;
          const user = p
            ? await this.prisma.user.findFirst({
                where: { id: p.userId, blockedAt: null, deletedAt: null },
                select: { id: true },
              })
            : null;
          let complete =
            !d ||
            !p ||
            !user ||
            keys.length === 0 ||
            alert.createdAt.getTime() < Date.now() - 24 * 60 * 60_000;
          if (!complete && d && p) {
            // Даём контекст всех текущих проблем. У каждого события свой
            // alertId: порядок отправок разными репликами не теряет дельты.
            const labels = Object.keys(PERMISSION_LABELS)
              .filter(
                (k) =>
                  state?.success &&
                  state.data[k as PermissionKey] === false &&
                  (k !== 'deviceAdmin' || d.child.protectionEnabled),
              )
              .map((k) => PERMISSION_LABELS[k as PermissionKey])
              .join(', ');
            complete = await this.fcm.sendHybridToToken({
              tokens: { fcmToken: p.fcmToken, rustorePushToken: p.rustorePushToken },
              data: {
                type: 'PERMISSION_DEGRADED',
                childId: d.childId,
                childName: d.child.name,
                permissionLabels: labels,
                alertId: alert.id,
              },
              rustoreNotification: {
                title: 'Отключены разрешения ребёнка',
                body: `${d.child.name}: отключено ${labels}. Откройте приложение ребёнка и восстановите разрешения.`,
              },
              label: `PERMISSION_DEGRADED child=${d.childId}`,
              onInvalidFcmToken: (t) => this.parents.clearTokenByExpired(t),
              onInvalidRustoreToken: (t) => this.parents.clearRustoreByExpired(t),
            });
          }
          await this.prisma.permissionAlert.updateMany({
            where: { id: alert.id, leaseUntil, completedAt: null },
            data: {
              completedAt: complete ? new Date() : null,
              leaseUntil: null,
              retryAt: new Date(Date.now() + 5 * 60_000),
            },
          });
        } catch (e) {
          this.logger.warn(`permission alert ${alert.id}: ${String(e)}`);
          // Lease истечёт даже при падении процесса; следующая попытка не теряется.
        }
      }
      await this.prisma.permissionAlert.deleteMany({
        where: {
          createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
        },
      });
    } finally {
      this.flushing = false;
    }
  }
}
