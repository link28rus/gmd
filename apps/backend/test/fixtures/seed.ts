import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../../src/prisma/prisma.service';

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

/**
 * Seeds a minimal family + child + device directly via Prisma,
 * bypassing the full HTTP claim flow. Returns a known raw device token
 * that can be used as the X-Child-Token header in tests.
 *
 * No consent records are created — ChildDevice creation itself does
 * not require them (only the claim endpoint's 14+ check does).
 */
export async function seedFamilyWithClaim(
  _app: INestApplication,
  prisma: PrismaService,
): Promise<{
  deviceToken: string;
  childId: string;
  childDeviceId: string;
  parentEmail: string;
}> {
  const uid = randomBytes(4).toString('hex');
  const parentEmail = `parent-${uid}@seed.test`;

  const user = await prisma.user.create({
    data: {
      email: parentEmail,
      emailVerifiedAt: new Date(),
      acceptedPrivacyPolicyVersion: '1.0',
    },
  });

  const family = await prisma.family.create({
    data: { name: 'Test Family' },
  });

  await prisma.membership.create({
    data: {
      userId: user.id,
      familyId: family.id,
      role: 'owner',
    },
  });

  const child = await prisma.child.create({
    data: {
      familyId: family.id,
      name: `Child-${uid}`,
    },
  });

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = sha256(rawToken);

  const device = await prisma.childDevice.create({
    data: {
      childId: child.id,
      tokenHash,
      deviceName: 'Test Device',
    },
  });

  return {
    deviceToken: rawToken,
    childId: child.id,
    childDeviceId: device.id,
    parentEmail,
  };
}
