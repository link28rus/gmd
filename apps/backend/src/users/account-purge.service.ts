import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createSoloFamily } from '../family/family-lifecycle';

/**
 * Удалённое (soft-delete) через 30 дней стирается из базы насовсем. До этого
 * срока админ может восстановить аккаунт, семью или ребёнка. Удалённые зоны
 * чистит pg_cron `zones-hard-delete` (миграция phase4_zones_postgis).
 *
 * Каскады FK уносят всё зависимое (точки, поездки, устройства, согласия,
 * токены). Три ссылки на пользователя стоят с Restrict, их разбираем руками:
 * зона живой семьи переходит её владельцу, сессии «Звука вокруг» и правила
 * блокировок, заведённые удалённым взрослым, удаляются.
 */
export const PURGE_AFTER_DAYS = 30;
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;

export interface PurgeResult {
  families: number;
  children: number;
  users: number;
}

@Injectable()
export class AccountPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountPurgeService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // В тестах чистку зовут явно, фоновый таймер только мешает.
    if (process.env.NODE_ENV === 'test') return;
    const tick = () =>
      void this.purgeExpired().catch((err) => this.logger.error(`purge failed: ${String(err)}`));
    this.timer = setTimeout(() => {
      tick();
      this.timer = setInterval(tick, RUN_EVERY_MS);
      this.timer.unref();
    }, FIRST_RUN_DELAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async purgeExpired(now = new Date()): Promise<PurgeResult> {
    const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const result: PurgeResult = { families: 0, children: 0, users: 0 };

    // Семьи первыми: их дети и зоны уходят каскадом.
    const families = await this.prisma.family.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const f of families) {
      await this.purgeFamily(f.id);
      result.families++;
    }

    const children = await this.prisma.child.deleteMany({ where: { deletedAt: { lt: cutoff } } });
    result.children = children.count;

    const users = await this.prisma.user.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const u of users) {
      await this.purgeUser(u.id);
      result.users++;
    }

    if (Object.values(result).some((n) => n > 0)) {
      this.logger.log(
        `purged: families=${result.families} children=${result.children} users=${result.users}`,
      );
    }
    return result;
  }

  /**
   * Семью удалил админ, а живые взрослые в ней остались — после удаления
   * каждый без другой семьи получает новую пустую (инвариант: у живого
   * пользователя ровно одно членство).
   */
  private async purgeFamily(familyId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const living = await tx.membership.findMany({
        where: { familyId, user: { deletedAt: null } },
        select: { userId: true },
      });
      await tx.family.delete({ where: { id: familyId } });
      for (const m of living) {
        const left = await tx.membership.count({ where: { userId: m.userId } });
        if (left === 0) await createSoloFamily(tx, m.userId);
      }
    });
  }

  private async purgeUser(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const zones = await tx.zone.findMany({
        where: { createdBy: userId },
        select: { id: true, familyId: true },
      });
      for (const z of zones) {
        const owner = await tx.membership.findFirst({
          where: { familyId: z.familyId, role: 'owner', userId: { not: userId } },
          select: { userId: true },
        });
        if (owner) {
          await tx.zone.update({ where: { id: z.id }, data: { createdBy: owner.userId } });
        } else {
          await tx.zone.delete({ where: { id: z.id } });
        }
      }
      await tx.audioSession.deleteMany({ where: { requestedById: userId } });
      await tx.blockSession.deleteMany({ where: { createdByUserId: userId } });
      await tx.appBlockSchedule.deleteMany({ where: { createdByUserId: userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  }
}
