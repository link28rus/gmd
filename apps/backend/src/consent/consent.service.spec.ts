/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConsentService } from './consent.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConsentConfig } from './consent.module';

function makeMockPrisma() {
  const consentRecords: any[] = [];
  const users: any[] = [];

  const tx = {
    consentRecord: {
      create: jest.fn(({ data }: any) => {
        const r = { id: `cr-${consentRecords.length}`, ...data };
        consentRecords.push(r);
        return Promise.resolve(r);
      }),
    },
    user: {
      update: jest.fn(({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id);
        if (u) Object.assign(u, data);
        return Promise.resolve(u ?? { id: where.id, ...data });
      }),
    },
  };

  return {
    _records: consentRecords,
    _users: users,
    consentRecord: {
      create: jest.fn(({ data }: any) => {
        const r = { id: `cr-${consentRecords.length}`, ...data };
        consentRecords.push(r);
        return Promise.resolve(r);
      }),
    },
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => u.id === where.id) ?? null),
      ),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    _tx: tx,
  };
}

function makeSvc(version = '1.0') {
  const prisma = makeMockPrisma();
  const cfg: ConsentConfig = { privacyPolicyVersion: version };
  const svc = new ConsentService(prisma as unknown as PrismaService, cfg);
  return { svc, prisma };
}

describe('ConsentService', () => {
  it('userRequiresConsent: true если null', () => {
    const { svc } = makeSvc('1.0');
    expect(svc.userRequiresConsent(null)).toBe(true);
  });

  it('userRequiresConsent: true если старая версия', () => {
    const { svc } = makeSvc('2.0');
    expect(svc.userRequiresConsent('1.0')).toBe(true);
  });

  it('userRequiresConsent: false если текущая версия', () => {
    const { svc } = makeSvc('1.0');
    expect(svc.userRequiresConsent('1.0')).toBe(false);
  });

  it('acceptForUser создаёт N records и обновляет User', async () => {
    const { svc, prisma } = makeSvc('1.0');
    await svc.acceptForUser('u-1', ['PRIVACY_POLICY', 'TERMS_OF_USE'], '1.2.3.4', 'TestAgent');
    expect(prisma._records).toHaveLength(2);
    expect(prisma._records[0].documentType).toBe('PRIVACY_POLICY');
    expect(prisma._records[1].documentType).toBe('TERMS_OF_USE');
    expect(prisma._records[0].subjectType).toBe('USER');
    expect(prisma._records[0].version).toBe('1.0');
    expect(prisma._records[0].ip).toBe('1.2.3.4');
    expect(prisma._tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: { acceptedPrivacyPolicyVersion: '1.0' },
      }),
    );
  });

  it('acceptForUser truncates userAgent to 500 chars', async () => {
    const { svc, prisma } = makeSvc('1.0');
    const longUa = 'A'.repeat(1000);
    await svc.acceptForUser('u-1', ['PRIVACY_POLICY'], undefined, longUa);
    expect(prisma._records[0].userAgent).toHaveLength(500);
  });

  it('recordChildConsent создаёт record с subjectType=CHILD', async () => {
    const { svc, prisma } = makeSvc('1.0');
    await svc.recordChildConsent('ch-1', 'u-parent', '10.0.0.1', 'App/1.0');
    expect(prisma._records).toHaveLength(1);
    const r = prisma._records[0];
    expect(r.subjectType).toBe('CHILD');
    expect(r.childId).toBe('ch-1');
    expect(r.userId).toBe('u-parent');
    expect(r.documentType).toBe('CHILD_14PLUS');
    expect(r.version).toBe('1.0');
  });

  it('getCurrentVersion возвращает версию из config', () => {
    const { svc } = makeSvc('2.5');
    expect(svc.getCurrentVersion()).toBe('2.5');
  });

  it('userRequiresConsentById делает lookup по userId', async () => {
    const { svc, prisma } = makeSvc('2.0');
    prisma._users.push({ id: 'u-1', acceptedPrivacyPolicyVersion: '1.0' });
    prisma.user.findUnique = jest.fn(({ where }: any) =>
      Promise.resolve(prisma._users.find((u: any) => u.id === where.id) ?? null),
    );
    const requires = await svc.userRequiresConsentById('u-1');
    expect(requires).toBe(true);
  });
});
