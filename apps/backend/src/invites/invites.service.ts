import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateInviteCode } from './lib/code-generator';

export interface InvitesServiceConfig {
  ttlSec: number;
  landingBaseUrl: string;
}

export const INVITES_CONFIG = Symbol('INVITES_CONFIG');

export interface InviteResult {
  code: string;
  qrUrl: string;
  deepLink: string;
  expiresIn: number;
}

@Injectable()
export class InvitesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(INVITES_CONFIG) private readonly cfg: InvitesServiceConfig,
  ) {}

  async createInvite(
    familyId: string,
    childId: string,
    createdBy: string,
    opts: { consent14PlusGranted?: boolean } = {},
  ): Promise<InviteResult> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null },
    });
    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    const activeDevice = await this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
    });
    if (activeDevice) {
      throw new ConflictException({
        code: 'child_has_device',
        message: 'Child already has an active device; reset first',
      });
    }
    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + this.cfg.ttlSec * 1000);
    await this.prisma.invite.create({
      data: {
        familyId,
        childId,
        code,
        expiresAt,
        createdBy,
        consent14PlusGranted: opts.consent14PlusGranted === true,
      },
    });
    return {
      code,
      qrUrl: `${this.cfg.landingBaseUrl}/claim/${code}`,
      deepLink: `gmd://claim/${code}`,
      expiresIn: this.cfg.ttlSec,
    };
  }

  async resetDevice(familyId: string, childId: string): Promise<void> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null },
    });
    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    const r = await this.prisma.childDevice.updateMany({
      where: { childId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) {
      throw new NotFoundException({ code: 'no_active_device', message: 'No active device' });
    }
  }
}
