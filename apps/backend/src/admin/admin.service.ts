/* eslint-disable @typescript-eslint/no-explicit-any */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
  ): Promise<{
    items: Array<{
      id: string;
      email: string;
      name: string | null;
      locale: string;
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
    const where = q ? { email: { contains: q, mode: 'insensitive' as const } } : {};
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          memberships: {
            include: { family: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
          _count: { select: { memberships: true } },
        },
      }),
    ]);

    const items = (rows as any[]).map((u) => {
      const primaryMembership = u.memberships[0] ?? null;
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        locale: u.locale,
        acceptedPrivacyPolicyVersion: u.acceptedPrivacyPolicyVersion,
        createdAt: u.createdAt,
        deletedAt: u.deletedAt,
        familyId: primaryMembership?.familyId ?? null,
        familyName: primaryMembership?.family?.name ?? null,
        childrenCount: 0,
      };
    });

    return { items, page, limit, total };
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
  ): Promise<{
    items: Array<{
      id: string;
      name: string;
      createdAt: Date;
      membersCount: number;
      childrenCount: number;
      activeDevicesCount: number;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const [total, rows] = await Promise.all([
      this.prisma.family.count(),
      this.prisma.family.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
  ): Promise<{
    items: Array<{
      id: string;
      name: string;
      dateOfBirth: Date | null;
      familyId: string;
      familyName: string;
      deviceStatus: 'active' | 'revoked' | 'none';
      deviceLastSeenAt: Date | null;
      deletedAt: Date | null;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const [total, rows] = await Promise.all([
      this.prisma.child.count(),
      this.prisma.child.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          family: { select: { name: true } },
          device: { select: { revokedAt: true, lastSeenAt: true } },
        },
      }),
    ]);

    const items = (rows as any[]).map((c) => {
      let deviceStatus: 'active' | 'revoked' | 'none' = 'none';
      if (c.device) {
        deviceStatus = c.device.revokedAt ? 'revoked' : 'active';
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

  async listActiveInvites(): Promise<{
    items: Array<{
      id: string;
      code: string;
      childId: string;
      childName: string;
      familyId: string;
      familyName: string;
      expiresAt: Date;
      consumedAt: Date | null;
      createdAt: Date;
      createdByEmail: string | null;
    }>;
  }> {
    const now = new Date();
    const rows = await this.prisma.invite.findMany({
      where: { consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      include: {
        child: { select: { name: true } },
        family: { select: { name: true } },
      },
    });

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
      createdAt: i.createdAt,
      createdByEmail: creatorMap.get(i.createdBy) ?? null,
    }));

    return { items };
  }
}
