import { Inject, Injectable } from '@nestjs/common';
import type { ConsentDocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CONSENT_CONFIG } from './consent.tokens';
import type { ConsentConfig } from './consent.tokens';

@Injectable()
export class ConsentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONSENT_CONFIG) private readonly cfg: ConsentConfig,
  ) {}

  getCurrentVersion(): string {
    return this.cfg.privacyPolicyVersion;
  }

  userRequiresConsent(acceptedVersion: string | null | undefined): boolean {
    return acceptedVersion !== this.cfg.privacyPolicyVersion;
  }

  async userRequiresConsentById(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { acceptedPrivacyPolicyVersion: true },
    });
    return this.userRequiresConsent(user?.acceptedPrivacyPolicyVersion ?? null);
  }

  async acceptForUser(
    userId: string,
    documents: ConsentDocumentType[],
    ip?: string,
    ua?: string,
  ): Promise<void> {
    const version = this.cfg.privacyPolicyVersion;
    const truncatedUa = ua?.slice(0, 500);
    await this.prisma.$transaction(async (tx) => {
      for (const doc of documents) {
        await tx.consentRecord.create({
          data: {
            subjectType: 'USER',
            userId,
            documentType: doc,
            version,
            ip: ip ?? null,
            userAgent: truncatedUa ?? null,
          },
        });
      }
      await tx.user.update({
        where: { id: userId },
        data: { acceptedPrivacyPolicyVersion: version },
      });
    });
  }

  async recordChildConsent(
    childId: string,
    parentUserId: string,
    ip?: string,
    ua?: string,
  ): Promise<void> {
    await this.prisma.consentRecord.create({
      data: {
        subjectType: 'CHILD',
        childId,
        userId: parentUserId,
        documentType: 'CHILD_14PLUS',
        version: this.cfg.privacyPolicyVersion,
        ip: ip ?? null,
        userAgent: ua?.slice(0, 500) ?? null,
      },
    });
  }
}
