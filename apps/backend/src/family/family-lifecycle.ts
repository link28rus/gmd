import type { Prisma } from '@prisma/client';

/**
 * v0.71.0: общие операции над членством в семье
 * (docs/superpowers/specs/2026-10-08-family-members.md).
 *
 * Инвариант: у живого пользователя ровно одно членство. Кто вышел или удалён
 * из семьи — сразу получает новую пустую семью, где он владелец.
 */

type Tx = Prisma.TransactionClient;

/** Новая пустая семья пользователя (как при регистрации: имя — фамилия). */
export async function createSoloFamily(
  tx: Tx,
  userId: string,
): Promise<{ id: string; name: string }> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { lastName: true },
  });
  const family = await tx.family.create({
    data: {
      ...(user.lastName?.trim() ? { name: user.lastName.trim() } : {}),
      memberships: { create: { userId, role: 'owner' } },
    },
    select: { id: true, name: true },
  });
  return family;
}

/**
 * Убрать членство и всё личное, что человек держал в этой семье:
 * настройки уведомлений геозон по её детям.
 */
export async function dropMembership(
  tx: Tx,
  membership: { id: string; userId: string; familyId: string },
): Promise<void> {
  await tx.zoneNotificationPref.deleteMany({
    where: { userId: membership.userId, child: { familyId: membership.familyId } },
  });
  await tx.membership.delete({ where: { id: membership.id } });
}

/**
 * Soft-delete всей семьи: дети, отвязка устройств, детские приглашения
 * и приглашения взрослых. Данные удалит ночной cron через 30 дней.
 */
export async function softDeleteFamily(tx: Tx, familyId: string, now: Date): Promise<void> {
  await tx.family.update({ where: { id: familyId }, data: { deletedAt: now } });
  await tx.child.updateMany({
    where: { familyId, deletedAt: null },
    data: { deletedAt: now },
  });
  await tx.childDevice.updateMany({
    where: { child: { familyId }, revokedAt: null },
    data: { revokedAt: now },
  });
  await tx.invite.updateMany({
    where: { familyId, consumedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
  await tx.familyInvite.updateMany({
    where: { familyId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
}

/**
 * Удаление аккаунта (DELETE /me и админка). Владелец с другими взрослыми —
 * права уходят самому раннему участнику, семья остаётся. Владелец один —
 * семья целиком в soft-delete. Участник — только его членство.
 * Возвращает userId наследников прав (им нужен свежий токен).
 */
export async function detachUserFromFamilies(tx: Tx, userId: string, now: Date): Promise<string[]> {
  const heirs: string[] = [];
  const memberships = await tx.membership.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  for (const m of memberships) {
    const siblings = await tx.membership.findMany({
      where: { familyId: m.familyId, userId: { not: userId } },
      orderBy: { createdAt: 'asc' },
    });
    if (m.role === 'owner' && siblings.length > 0) {
      const heir = siblings[0]!;
      await tx.membership.update({ where: { id: heir.id }, data: { role: 'owner' } });
      heirs.push(heir.userId);
    } else if (m.role === 'owner') {
      await softDeleteFamily(tx, m.familyId, now);
    }
    await dropMembership(tx, m);
  }
  return heirs;
}
