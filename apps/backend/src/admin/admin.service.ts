/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { detachUserFromFamilies } from '../family/family-lifecycle';
import { PasswordResetService } from '../auth/password-reset.service';

export type AdminUserAction =
  | 'make_admin'
  | 'revoke_admin'
  | 'block'
  | 'unblock'
  | 'reset_password'
  | 'delete';

export type SortDir = 'asc' | 'desc';

/**
 * Собирает Prisma orderBy из пользовательского sortBy с whitelist'ом полей.
 * Неизвестное поле → fallback. Защищает от инъекции произвольного имени
 * колонки в orderBy.
 */
function buildOrderBy(
  sortBy: string | undefined,
  sortDir: SortDir | undefined,
  allowed: readonly string[],
  fallback: string,
): Record<string, SortDir> {
  const field = sortBy && allowed.includes(sortBy) ? sortBy : fallback;
  return { [field]: sortDir ?? 'desc' };
}

const USER_SORT_FIELDS = ['createdAt', 'email', 'name', 'lastSeenAt', 'role'] as const;
const FAMILY_SORT_FIELDS = ['createdAt', 'name', 'deletedAt'] as const;
const CHILD_SORT_FIELDS = ['createdAt', 'name', 'dateOfBirth', 'deletedAt'] as const;

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordResetService) private readonly passwordReset: PasswordResetService,
  ) {}

  async getStats(): Promise<{
    users: { total: number; deleted: number };
    families: { total: number };
    children: { total: number; deleted: number };
    devices: { total: number; active: number; revoked: number };
    invites: { total: number; activeNow: number };
  }> {
    const now = new Date();
    const [
      usersTotal,
      usersDeleted,
      familiesTotal,
      childrenTotal,
      childrenDeleted,
      devicesTotal,
      devicesRevoked,
      invitesTotal,
      invitesActive,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { deletedAt: { not: null } } }),
      this.prisma.family.count(),
      this.prisma.child.count(),
      this.prisma.child.count({ where: { deletedAt: { not: null } } }),
      this.prisma.childDevice.count(),
      this.prisma.childDevice.count({ where: { revokedAt: { not: null } } }),
      this.prisma.invite.count(),
      this.prisma.invite.count({
        where: { consumedAt: null, expiresAt: { gt: now } },
      }),
    ]);

    return {
      users: { total: usersTotal, deleted: usersDeleted },
      families: { total: familiesTotal },
      children: { total: childrenTotal, deleted: childrenDeleted },
      devices: {
        total: devicesTotal,
        active: devicesTotal - devicesRevoked,
        revoked: devicesRevoked,
      },
      invites: { total: invitesTotal, activeNow: invitesActive },
    };
  }

  async listUsers(
    page: number,
    limit: number,
    q?: string,
    showDeleted = false,
    sortBy?: string,
    sortDir?: SortDir,
  ): Promise<{
    items: Array<{
      id: string;
      email: string;
      name: string | null;
      locale: string;
      role: 'admin' | 'parent';
      blockedAt: Date | null;
      blockedReason: string | null;
      lastSeenAt: Date | null;
      acceptedPrivacyPolicyVersion: string | null;
      createdAt: Date;
      deletedAt: Date | null;
      familyId: string | null;
      familyName: string | null;
      childrenCount: number;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const where: Record<string, unknown> = {};
    if (!showDeleted) where.deletedAt = null;
    if (q) where.email = { contains: q, mode: 'insensitive' as const };

    const orderBy = buildOrderBy(sortBy, sortDir, USER_SORT_FIELDS, 'createdAt');

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          // Все membership'ы: первый (по времени) — для отображения «основной»
          // семьи, остальные familyId нужны для подсчёта childrenCount.
          memberships: {
            include: { family: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
    ]);

    // childrenCount = число не-удалённых детей во всех семьях пользователя.
    // Считаем одним groupBy по всем familyId страницы (без N+1).
    const allFamilyIds = [
      ...new Set((rows as any[]).flatMap((u) => u.memberships.map((m: any) => m.familyId))),
    ] as string[];
    const childCounts =
      allFamilyIds.length > 0
        ? await this.prisma.child.groupBy({
            by: ['familyId'],
            where: { familyId: { in: allFamilyIds }, deletedAt: null },
            _count: { _all: true },
          })
        : [];
    const countByFamily = new Map(
      (childCounts as any[]).map((c) => [c.familyId, c._count._all as number]),
    );

    const items = (rows as any[]).map((u) => {
      const primaryMembership = u.memberships[0] ?? null;
      const uniqueFamilyIds = [...new Set(u.memberships.map((m: any) => m.familyId))] as string[];
      const childrenCount = uniqueFamilyIds.reduce(
        (sum, fid) => sum + (countByFamily.get(fid) ?? 0),
        0,
      );
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        locale: u.locale,
        role: u.role as 'admin' | 'parent',
        blockedAt: u.blockedAt ?? null,
        blockedReason: u.blockedReason ?? null,
        lastSeenAt: u.lastSeenAt ?? null,
        acceptedPrivacyPolicyVersion: u.acceptedPrivacyPolicyVersion,
        createdAt: u.createdAt,
        deletedAt: u.deletedAt,
        familyId: primaryMembership?.familyId ?? null,
        familyName: primaryMembership?.family?.name ?? null,
        childrenCount,
      };
    });

    return { items, page, limit, total };
  }

  /** Снять soft-delete с пользователя (восстановление до ночного hard-delete cron). */
  async restoreUser(targetUserId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deletedAt: true },
    });
    if (!target) {
      throw new NotFoundException({ code: 'not_found', message: 'User not found' });
    }
    if (!target.deletedAt) {
      throw new BadRequestException({ code: 'not_deleted', message: 'User is not deleted' });
    }
    // Восстанавливаем только сам аккаунт. Membership'ы при удалении были
    // удалены физически (delete, не soft) — если семья ушла каскадом, её
    // восстанавливают отдельно. blockedById чистим (он использовался как
    // «кто удалил»).
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { deletedAt: null, blockedById: null },
    });
  }

  async setRole(
    targetUserId: string,
    role: 'admin' | 'parent',
    actorUserId: string,
  ): Promise<void> {
    if (targetUserId === actorUserId && role !== 'admin') {
      // Защита от «уволил сам себя и потерял доступ». Админ должен сначала
      // назначить другого, потом может снять с себя.
      throw new BadRequestException({
        code: 'self_demotion_forbidden',
        message: 'You cannot demote yourself while still the only admin',
      });
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deletedAt: true },
    });
    if (!target || target.deletedAt) {
      throw new NotFoundException({ code: 'not_found', message: 'User not found' });
    }
    await this.prisma.user.update({ where: { id: targetUserId }, data: { role } });
  }

  async blockUser(targetUserId: string, reason: string | null, actorUserId: string): Promise<void> {
    if (targetUserId === actorUserId) {
      throw new BadRequestException({
        code: 'cannot_block_self',
        message: 'You cannot block yourself',
      });
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deletedAt: true, blockedAt: true },
    });
    if (!target || target.deletedAt) {
      throw new NotFoundException({ code: 'not_found', message: 'User not found' });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: {
          blockedAt: new Date(),
          blockedReason: reason?.trim() || null,
          blockedById: actorUserId,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async unblockUser(targetUserId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deletedAt: true },
    });
    if (!target || target.deletedAt) {
      throw new NotFoundException({ code: 'not_found', message: 'User not found' });
    }
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { blockedAt: null, blockedReason: null, blockedById: null },
    });
  }

  /**
   * Админ инициирует сброс пароля пользователем — бэк шлёт юзеру письмо с
   * ссылкой на самостоятельную смену. Сам пароль админ не видит и не задаёт.
   */
  async initiatePasswordReset(targetUserId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, name: true, deletedAt: true },
    });
    if (!target || target.deletedAt) {
      throw new NotFoundException({ code: 'not_found', message: 'User not found' });
    }
    await this.passwordReset.issueAndSend(target.id, target.email, target.name ?? target.email);
  }

  /**
   * Soft-delete юзера + cascade по всей привязанной к нему информации. Если
   * юзер был owner'ом семьи и в семье есть другие parent'ы — ownership
   * передаётся самому раннему parent'у, семья остаётся. Иначе вся семья
   * (дети, устройства, зоны, invites, локации через FK-cascade) уходит в
   * soft-delete и будет удалена ночным cron'ом через 30 дней.
   */
  async softDeleteUser(targetUserId: string, actorUserId: string): Promise<void> {
    if (targetUserId === actorUserId) {
      throw new BadRequestException({
        code: 'cannot_delete_self',
        message: 'You cannot delete yourself',
      });
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target || target.deletedAt) {
      throw new NotFoundException({ code: 'not_found', message: 'User not found' });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await detachUserFromFamilies(tx, target.id, now);

      await tx.refreshToken.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.user.update({
        where: { id: target.id },
        data: { deletedAt: now, blockedById: actorUserId },
      });
    });
  }

  async getUserDetail(id: string): Promise<{
    user: {
      id: string;
      email: string;
      name: string | null;
      locale: string;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      acceptedPrivacyPolicyVersion: string | null;
    };
    memberships: Array<{ familyId: string; familyName: string; role: string }>;
    children: Array<{
      id: string;
      name: string;
      dateOfBirth: Date | null;
      hasDevice: boolean;
      deviceLastSeenAt: Date | null;
    }>;
    refreshTokensActive: number;
    otpCodesActiveLast24h: number;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        memberships: {
          include: { family: { select: { name: true } } },
        },
      },
    });

    if (!user) {
      throw new NotFoundException({ code: 'not_found', message: 'User not found' });
    }

    const now = new Date();
    const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const familyIds = (user as any).memberships.map((m: any) => m.familyId);
    const [children, refreshTokensActive, otpCodesActiveLast24h] = await Promise.all([
      familyIds.length > 0
        ? this.prisma.child.findMany({
            where: { familyId: { in: familyIds }, deletedAt: null },
            include: { device: { select: { lastSeenAt: true, revokedAt: true } } },
          })
        : Promise.resolve([]),
      this.prisma.refreshToken.count({
        where: { userId: id, revokedAt: null, expiresAt: { gt: now } },
      }),
      this.prisma.otpCode.count({
        where: { userId: id, createdAt: { gte: ago24h }, consumedAt: null },
      }),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        deletedAt: user.deletedAt,
        acceptedPrivacyPolicyVersion: user.acceptedPrivacyPolicyVersion,
      },
      memberships: (user as any).memberships.map((m: any) => ({
        familyId: m.familyId,
        familyName: m.family?.name ?? '',
        role: m.role,
      })),
      children: (children as any[]).map((c) => ({
        id: c.id,
        name: c.name,
        dateOfBirth: c.dateOfBirth,
        hasDevice: !!c.device && !c.device.revokedAt,
        deviceLastSeenAt: c.device?.lastSeenAt ?? null,
      })),
      refreshTokensActive,
      otpCodesActiveLast24h,
    };
  }

  async listFamilies(
    page: number,
    limit: number,
    q?: string,
    showDeleted = false,
    sortBy?: string,
    sortDir?: SortDir,
  ): Promise<{
    items: Array<{
      id: string;
      name: string;
      createdAt: Date;
      deletedAt: Date | null;
      membersCount: number;
      childrenCount: number;
      activeDevicesCount: number;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const where: Record<string, unknown> = {};
    if (!showDeleted) where.deletedAt = null;
    if (q) where.name = { contains: q, mode: 'insensitive' as const };

    const orderBy = buildOrderBy(sortBy, sortDir, FAMILY_SORT_FIELDS, 'createdAt');

    const [total, rows] = await Promise.all([
      this.prisma.family.count({ where }),
      this.prisma.family.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          _count: { select: { memberships: true, children: true } },
          children: {
            where: { deletedAt: null },
            include: { device: { select: { revokedAt: true } } },
          },
        },
      }),
    ]);

    const items = (rows as any[]).map((f) => {
      const activeDevices = f.children.filter(
        (c: any) => c.device && c.device.revokedAt === null,
      ).length;
      return {
        id: f.id,
        name: f.name,
        createdAt: f.createdAt,
        deletedAt: f.deletedAt,
        membersCount: f._count.memberships,
        childrenCount: f._count.children,
        activeDevicesCount: activeDevices,
      };
    });

    return { items, page, limit, total };
  }

  async listChildren(
    page: number,
    limit: number,
    q?: string,
    showDeleted = false,
    sortBy?: string,
    sortDir?: SortDir,
  ): Promise<{
    items: Array<{
      id: string;
      name: string;
      dateOfBirth: Date | null;
      familyId: string;
      familyName: string;
      deviceStatus: 'online' | 'offline' | 'revoked' | 'none';
      deviceLastSeenAt: Date | null;
      deletedAt: Date | null;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const where: Record<string, unknown> = {};
    if (!showDeleted) where.deletedAt = null;
    if (q) where.name = { contains: q, mode: 'insensitive' as const };

    const orderBy = buildOrderBy(sortBy, sortDir, CHILD_SORT_FIELDS, 'createdAt');

    const [total, rows] = await Promise.all([
      this.prisma.child.count({ where }),
      this.prisma.child.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          family: { select: { name: true } },
          device: { select: { revokedAt: true, lastSeenAt: true } },
        },
      }),
    ]);

    const onlineThresholdMs = 5 * 60 * 1000;
    const now = Date.now();
    const items = (rows as any[]).map((c) => {
      let deviceStatus: 'online' | 'offline' | 'revoked' | 'none' = 'none';
      if (c.device) {
        if (c.device.revokedAt) {
          deviceStatus = 'revoked';
        } else if (
          c.device.lastSeenAt &&
          now - new Date(c.device.lastSeenAt).getTime() < onlineThresholdMs
        ) {
          deviceStatus = 'online';
        } else {
          deviceStatus = 'offline';
        }
      }
      return {
        id: c.id,
        name: c.name,
        dateOfBirth: c.dateOfBirth,
        familyId: c.familyId,
        familyName: c.family?.name ?? '',
        deviceStatus,
        deviceLastSeenAt: c.device?.lastSeenAt ?? null,
        deletedAt: c.deletedAt,
      };
    });

    return { items, page, limit, total };
  }

  /**
   * Soft-delete семьи вручную (из админки). Каскадно soft-deleteим детей,
   * revoke-аем устройства, гасим активные invites. Сам юзер-owner остаётся —
   * админ обычно удаляет семью отдельно от юзера.
   */
  async softDeleteFamily(familyId: string): Promise<void> {
    const family = await this.prisma.family.findUnique({
      where: { id: familyId },
      select: { id: true, deletedAt: true },
    });
    if (!family) {
      throw new NotFoundException({ code: 'not_found', message: 'Family not found' });
    }
    if (family.deletedAt) {
      throw new BadRequestException({
        code: 'already_deleted',
        message: 'Family already deleted',
      });
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.family.update({ where: { id: familyId }, data: { deletedAt: now } }),
      this.prisma.child.updateMany({
        where: { familyId, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.childDevice.updateMany({
        where: { child: { familyId }, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.invite.updateMany({
        where: { familyId, consumedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
    ]);
  }

  /**
   * Восстановить soft-deleted семью. Возвращаем deletedAt=null самой семье и
   * тем детям, которые были удалены ТЕМ ЖЕ каскадом (child.deletedAt точно
   * равен family.deletedAt — softDeleteFamily ставит единый timestamp через
   * updateMany). Дети, удалённые раньше отдельно, остаются удалёнными.
   * Устройства/инвайты не восстанавливаем: устройство ребёнок перепривяжет,
   * QR-код создаётся заново.
   */
  async restoreFamily(familyId: string): Promise<void> {
    const family = await this.prisma.family.findUnique({
      where: { id: familyId },
      select: { id: true, deletedAt: true },
    });
    if (!family) {
      throw new NotFoundException({ code: 'not_found', message: 'Family not found' });
    }
    if (!family.deletedAt) {
      throw new BadRequestException({ code: 'not_deleted', message: 'Family is not deleted' });
    }
    const deletedAt = family.deletedAt;
    await this.prisma.$transaction([
      this.prisma.family.update({ where: { id: familyId }, data: { deletedAt: null } }),
      this.prisma.child.updateMany({
        where: { familyId, deletedAt },
        data: { deletedAt: null },
      }),
    ]);
  }

  async softDeleteChild(childId: string): Promise<void> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, deletedAt: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'not_found', message: 'Child not found' });
    }
    if (child.deletedAt) {
      throw new BadRequestException({
        code: 'already_deleted',
        message: 'Child already deleted',
      });
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.child.update({ where: { id: childId }, data: { deletedAt: now } }),
      this.prisma.childDevice.updateMany({
        where: { childId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.invite.updateMany({
        where: { childId, consumedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
    ]);
  }

  /**
   * Восстановить soft-deleted ребёнка. Требует, чтобы его семья была активна
   * (иначе сначала восстанови семью). Устройство/инвайты не трогаем.
   */
  async restoreChild(childId: string): Promise<void> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, deletedAt: true, family: { select: { deletedAt: true } } },
    });
    if (!child) {
      throw new NotFoundException({ code: 'not_found', message: 'Child not found' });
    }
    if (!child.deletedAt) {
      throw new BadRequestException({ code: 'not_deleted', message: 'Child is not deleted' });
    }
    if ((child as any).family?.deletedAt) {
      throw new BadRequestException({
        code: 'family_deleted',
        message: 'Restore the family first',
      });
    }
    await this.prisma.child.update({ where: { id: childId }, data: { deletedAt: null } });
  }

  async resetChildDevice(childId: string): Promise<void> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      include: { device: { select: { id: true, revokedAt: true } } },
    });
    if (!child || child.deletedAt) {
      throw new NotFoundException({ code: 'not_found', message: 'Child not found' });
    }
    const device = (child as any).device as { id: string; revokedAt: Date | null } | null;
    if (!device) {
      throw new BadRequestException({
        code: 'no_device',
        message: 'Child has no device',
      });
    }
    if (device.revokedAt) {
      throw new BadRequestException({
        code: 'already_revoked',
        message: 'Device already revoked',
      });
    }
    await this.prisma.childDevice.update({
      where: { id: device.id },
      data: { revokedAt: new Date() },
    });
  }

  async listInvites(
    page: number,
    limit: number,
    q?: string,
  ): Promise<{
    items: Array<{
      id: string;
      code: string;
      childId: string;
      childName: string;
      familyId: string;
      familyName: string;
      expiresAt: Date;
      consumedAt: Date | null;
      maxUses: number;
      usesCount: number;
      createdAt: Date;
      createdByEmail: string | null;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const now = new Date();
    const where: Record<string, unknown> = { consumedAt: null, expiresAt: { gt: now } };
    if (q) {
      where.OR = [
        { code: { contains: q, mode: 'insensitive' as const } },
        { child: { name: { contains: q, mode: 'insensitive' as const } } },
        { family: { name: { contains: q, mode: 'insensitive' as const } } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.invite.count({ where }),
      this.prisma.invite.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          child: { select: { name: true } },
          family: { select: { name: true } },
        },
      }),
    ]);

    // Fetch creator emails
    const creatorIds = [...new Set((rows as any[]).map((r) => r.createdBy))];
    const creators =
      creatorIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, email: true },
          })
        : [];
    const creatorMap = new Map((creators as any[]).map((u) => [u.id, u.email]));

    const items = (rows as any[]).map((i) => ({
      id: i.id,
      code: i.code,
      childId: i.childId,
      childName: i.child?.name ?? '',
      familyId: i.familyId,
      familyName: i.family?.name ?? '',
      expiresAt: i.expiresAt,
      consumedAt: i.consumedAt,
      maxUses: i.maxUses,
      usesCount: i.usesCount,
      createdAt: i.createdAt,
      createdByEmail: creatorMap.get(i.createdBy) ?? null,
    }));

    return { items, page, limit, total };
  }

  /**
   * Отозвать активный QR-инвайт: гасим через expiresAt=now (invite исчезает из
   * active-списка и claim по нему возвращает invite_invalid).
   */
  async revokeInvite(inviteId: string): Promise<void> {
    const now = new Date();
    const invite = await this.prisma.invite.findUnique({
      where: { id: inviteId },
      select: { id: true, consumedAt: true, expiresAt: true },
    });
    if (!invite) {
      throw new NotFoundException({ code: 'not_found', message: 'Invite not found' });
    }
    if (invite.consumedAt || invite.expiresAt <= now) {
      throw new BadRequestException({
        code: 'already_inactive',
        message: 'Invite already inactive',
      });
    }
    await this.prisma.invite.update({ where: { id: inviteId }, data: { expiresAt: now } });
  }
}
