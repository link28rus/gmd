import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MembershipRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StaleTokenService } from '../auth/stale-token.service';
import { PasswordService } from '../auth/password.service';
import { generateInviteCode, normalizeInviteCode } from '../invites/lib/code-generator';
import { displayName } from '../parent-location/parent-location.service';
import {
  createSoloFamily,
  detachUserFromFamilies,
  dropMembership,
  softDeleteFamily,
} from './family-lifecycle';

/**
 * v0.71.0: участники семьи — приглашение взрослого, удаление, выход, передача
 * прав (docs/superpowers/specs/2026-10-08-family-members.md). Роль берётся
 * из БД, не из JWT. После смены членства — StaleTokenService.markStale.
 */

export const MEMBER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_MEMBER_INVITES = 10;
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

export interface FamilyMemberDto {
  userId: string;
  displayName: string;
  email: string;
  role: MembershipRole;
  joinedAt: string;
  isMe: boolean;
}

export interface MemberInviteDto {
  id: string;
  code: string;
  url: string;
  expiresAt: string;
  createdAt: string;
}

export type JoinBlockReason = 'already_member' | 'has_children' | 'has_members';

export interface JoinCheck {
  canJoin: boolean;
  reason?: JoinBlockReason;
  currentFamilyName?: string;
  children?: number;
  members?: number;
}

function webBaseUrl(): string {
  return process.env.WEB_BASE_URL?.replace(/\/+$/, '') || 'https://gmd.link28rus.ru';
}

function inviteInvalid(): NotFoundException {
  return new NotFoundException({
    code: 'invite_invalid',
    message: 'Приглашение не найдено, истекло или уже использовано',
  });
}

@Injectable()
export class FamilyMembersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StaleTokenService) private readonly stale: StaleTokenService,
    @Inject(PasswordService) private readonly password: PasswordService,
  ) {}

  /** Текущее членство пользователя (инвариант — одно; берём самое раннее). */
  private async myMembership(db: Db, userId: string) {
    const m = await db.membership.findFirst({
      where: { userId, family: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      include: { family: { select: { id: true, name: true } } },
    });
    if (!m) {
      throw new NotFoundException({ code: 'not_found', message: 'Family not found' });
    }
    return m;
  }

  private async requireOwner(db: Db, userId: string) {
    const m = await this.myMembership(db, userId);
    if (m.role !== 'owner') {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'Только владелец семьи может это сделать',
      });
    }
    return m;
  }

  /**
   * Членство под блокировкой строки семьи: передача прав, удаление и выход
   * в одной семье выполняются по очереди (иначе две передачи → два владельца).
   */
  private async myMembershipLocked(tx: Tx, userId: string) {
    const m = await this.myMembership(tx, userId);
    await tx.$queryRaw`SELECT id FROM families WHERE id = ${m.familyId} FOR UPDATE`;
    return this.myMembership(tx, userId);
  }

  private async requireOwnerLocked(tx: Tx, userId: string) {
    const m = await this.myMembershipLocked(tx, userId);
    if (m.role !== 'owner') {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'Только владелец семьи может это сделать',
      });
    }
    return m;
  }

  async listMembers(userId: string): Promise<{
    family: { id: string; name: string };
    myRole: MembershipRole;
    members: FamilyMemberDto[];
  }> {
    const me = await this.myMembership(this.prisma, userId);
    const rows = await this.prisma.membership.findMany({
      where: { familyId: me.familyId, user: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, email: true, name: true, firstName: true } } },
    });
    const members = rows
      .map((r) => ({
        userId: r.userId,
        displayName: displayName(r.user),
        email: r.user.email,
        role: r.role,
        joinedAt: r.createdAt.toISOString(),
        isMe: r.userId === userId,
      }))
      // Владелец первым, дальше по времени вступления.
      .sort((a, b) => (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1));
    return { family: me.family, myRole: me.role, members };
  }

  // ---------- приглашения ----------

  private activeWhere(familyId: string, now = new Date()): Prisma.FamilyInviteWhereInput {
    return { familyId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
  }

  private toInviteDto(i: {
    id: string;
    code: string;
    expiresAt: Date;
    createdAt: Date;
  }): MemberInviteDto {
    return {
      id: i.id,
      code: i.code,
      url: `${webBaseUrl()}/join/${i.code}`,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    };
  }

  async createInvite(userId: string): Promise<MemberInviteDto> {
    const me = await this.requireOwner(this.prisma, userId);
    const active = await this.prisma.familyInvite.count({ where: this.activeWhere(me.familyId) });
    if (active >= MAX_ACTIVE_MEMBER_INVITES) {
      throw new ConflictException({
        code: 'too_many_invites',
        message: 'Слишком много активных приглашений — отзовите ненужные',
      });
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const inv = await this.prisma.familyInvite.create({
          data: {
            familyId: me.familyId,
            code: generateInviteCode(),
            createdById: userId,
            expiresAt: new Date(Date.now() + MEMBER_INVITE_TTL_MS),
          },
        });
        return this.toInviteDto(inv);
      } catch (e) {
        const dup = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!dup || attempt >= 4) throw e;
      }
    }
  }

  async listInvites(userId: string): Promise<MemberInviteDto[]> {
    const me = await this.requireOwner(this.prisma, userId);
    const rows = await this.prisma.familyInvite.findMany({
      where: this.activeWhere(me.familyId),
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toInviteDto(r));
  }

  async revokeInvite(userId: string, inviteId: string): Promise<void> {
    const me = await this.requireOwner(this.prisma, userId);
    const r = await this.prisma.familyInvite.updateMany({
      where: { id: inviteId, ...this.activeWhere(me.familyId) },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) {
      throw new NotFoundException({ code: 'not_found', message: 'Invite not found' });
    }
  }

  /** Можно ли пользователю перейти в семью `targetFamilyId`. */
  private async checkJoin(db: Db, userId: string, targetFamilyId: string): Promise<JoinCheck> {
    const memberships = await db.membership.findMany({
      where: { userId },
      include: { family: { select: { name: true, deletedAt: true } } },
    });
    if (memberships.some((m) => m.familyId === targetFamilyId)) {
      return { canJoin: false, reason: 'already_member' };
    }
    for (const m of memberships) {
      if (m.family.deletedAt) continue;
      const [children, members] = await Promise.all([
        db.child.count({ where: { familyId: m.familyId, deletedAt: null } }),
        db.membership.count({ where: { familyId: m.familyId, userId: { not: userId } } }),
      ]);
      if (children > 0 || members > 0) {
        return {
          canJoin: false,
          reason: members > 0 ? 'has_members' : 'has_children',
          currentFamilyName: m.family.name,
          children,
          members,
        };
      }
    }
    return { canJoin: true };
  }

  async previewInvite(
    userId: string,
    rawCode: string,
  ): Promise<{ family: { name: string }; invitedBy: string; expiresAt: string } & JoinCheck> {
    const code = normalizeInviteCode(rawCode ?? '');
    if (!CODE_RE.test(code)) throw inviteInvalid();
    const inv = await this.prisma.familyInvite.findFirst({
      where: {
        code,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        family: { deletedAt: null },
      },
      include: {
        family: { select: { name: true } },
        createdBy: { select: { name: true, firstName: true, email: true } },
      },
    });
    if (!inv) throw inviteInvalid();
    const check = await this.checkJoin(this.prisma, userId, inv.familyId);
    return {
      family: { name: inv.family.name },
      invitedBy: displayName(inv.createdBy),
      expiresAt: inv.expiresAt.toISOString(),
      ...check,
    };
  }

  async acceptInvite(
    userId: string,
    rawCode: string,
  ): Promise<{ family: { id: string; name: string }; role: 'parent' }> {
    const code = normalizeInviteCode(rawCode ?? '');
    if (!CODE_RE.test(code)) throw inviteInvalid();
    const now = new Date();

    const family = await this.prisma.$transaction(async (tx) => {
      // Блокировка строки: два одновременных принятия одного кода — второе получит invite_invalid.
      const rows = await tx.$queryRaw<{ id: string; familyId: string }[]>`
        SELECT fi.id, fi."familyId"
          FROM family_invites fi
          JOIN families f ON f.id = fi."familyId"
         WHERE fi.code = ${code}
           AND fi."acceptedAt" IS NULL
           AND fi."revokedAt" IS NULL
           AND fi."expiresAt" > NOW()
           AND f."deletedAt" IS NULL
         FOR UPDATE OF fi`;
      const inv = rows[0];
      if (!inv) throw inviteInvalid();

      const check = await this.checkJoin(tx, userId, inv.familyId);
      if (!check.canJoin) {
        if (check.reason === 'already_member') {
          throw new ConflictException({
            code: 'already_member',
            message: 'Вы уже состоите в этой семье',
          });
        }
        throw new ConflictException({
          code: 'current_family_not_empty',
          message:
            check.reason === 'has_members'
              ? 'В вашей текущей семье есть другие взрослые — сначала выйдите из неё'
              : 'В вашей текущей семье есть дети — сначала удалите их',
          reason: check.reason,
          currentFamilyName: check.currentFamilyName,
          children: check.children,
          members: check.members,
        });
      }

      // Прежняя семья пуста (ни детей, ни других взрослых) — растворяем её.
      const old = await tx.membership.findMany({ where: { userId } });
      for (const m of old) {
        await softDeleteFamily(tx, m.familyId, now);
        await dropMembership(tx, m);
      }

      await tx.membership.create({ data: { userId, familyId: inv.familyId, role: 'parent' } });
      await tx.familyInvite.update({
        where: { id: inv.id },
        data: { acceptedAt: now, acceptedById: userId },
      });
      return tx.family.findUniqueOrThrow({
        where: { id: inv.familyId },
        select: { id: true, name: true },
      });
    });

    await this.stale.markStale([userId]);
    return { family, role: 'parent' };
  }

  // ---------- участники ----------

  /**
   * v0.72.0: владелец заводит взрослого сам — email + пароль, без письма и
   * подтверждения. Живой подтверждённый аккаунт с этим email → 409
   * `email_taken`: чужой аккаунт так не забрать, ему — приглашение.
   * v0.72.1: удалённый (deletedAt) или так и не подтверждённый аккаунт
   * занимается заново, как в auth.service register — запись переиспользуется
   * (на неё ссылаются зоны/аудио с onDelete: Restrict, физически не удалить),
   * всё прежнее отвязывается: семьи, сессии, устройства, точки, токены.
   * Политику участник принимает сам при первом входе
   * (acceptedPrivacyPolicyVersion = null → баннер в кабинете / экран в приложении).
   */
  async createMember(
    actorId: string,
    dto: {
      email: string;
      lastName: string;
      firstName: string;
      middleName?: string;
      password: string;
    },
  ): Promise<FamilyMemberDto> {
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await this.password.hash(dto.password);
    // Как в auth.service register: «Фамилия Имя Отчество».
    const fullName = [dto.lastName, dto.firstName, dto.middleName]
      .filter((s) => s && s.trim())
      .join(' ');
    let reclaimedId: string | null = null;
    try {
      const member = await this.prisma.$transaction(async (tx) => {
        const me = await this.requireOwnerLocked(tx, actorId);
        const profile = {
          lastName: dto.lastName,
          firstName: dto.firstName,
          middleName: dto.middleName ?? null,
          name: fullName,
          passwordHash,
          emailVerifiedAt: new Date(),
        };
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing && !existing.deletedAt && existing.emailVerifiedAt) {
          throw new ConflictException({
            code: 'email_taken',
            message: 'Этот email уже зарегистрирован — отправьте человеку приглашение',
          });
        }
        if (existing) await this.wipeReclaimedUser(tx, existing.id);
        const user = existing
          ? await tx.user.update({
              where: { id: existing.id },
              data: {
                ...profile,
                role: 'parent',
                deletedAt: null,
                blockedAt: null,
                blockedReason: null,
                blockedById: null,
                lastSeenAt: null,
                locale: 'ru',
                acceptedPrivacyPolicyVersion: null,
                shareLocationWithFamily: true,
                memberships: { create: { familyId: me.familyId, role: 'parent' } },
              },
              include: { memberships: true },
            })
          : await tx.user.create({
              data: {
                email,
                ...profile,
                memberships: { create: { familyId: me.familyId, role: 'parent' } },
              },
              include: { memberships: true },
            });
        reclaimedId = existing?.id ?? null;
        return {
          userId: user.id,
          displayName: displayName(user),
          email: user.email,
          role: 'parent' as const,
          joinedAt: user.memberships[0]!.createdAt.toISOString(),
          isMe: false,
        };
      });
      // Старые access-токены прежнего владельца записи больше не действуют.
      if (reclaimedId) await this.stale.markStale([reclaimedId]);
      return member;
    } catch (e) {
      // Гонка: тот же email создали параллельно.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'email_taken',
          message: 'Этот email уже зарегистрирован — отправьте человеку приглашение',
        });
      }
      throw e;
    }
  }

  /**
   * Перед повторным занятием email: отвязать всё, что осталось от прежнего
   * владельца записи. Неподтверждённый — растворить его пустую семью
   * (detachUserFromFamilies), удалённый — членств уже нет. История согласий
   * остаётся (аудит), согласие с политикой новый человек даст сам.
   */
  private async wipeReclaimedUser(tx: Tx, userId: string): Promise<void> {
    const now = new Date();
    await detachUserFromFamilies(tx, userId, now);
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.parentDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.parentLocationDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.parentLocation.deleteMany({ where: { userId } });
    await tx.emailVerificationToken.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.otpCode.deleteMany({ where: { userId } });
  }

  async removeMember(actorId: string, targetUserId: string): Promise<void> {
    if (actorId === targetUserId) {
      throw new BadRequestException({
        code: 'cannot_remove_self',
        message: 'Нельзя удалить себя — используйте «Выйти из семьи»',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const me = await this.requireOwnerLocked(tx, actorId);
      const target = await tx.membership.findFirst({
        where: { familyId: me.familyId, userId: targetUserId },
      });
      if (!target) {
        throw new NotFoundException({ code: 'not_found', message: 'Member not found' });
      }
      await dropMembership(tx, target);
      await createSoloFamily(tx, targetUserId);
    });
    await this.stale.markStale([targetUserId]);
  }

  async leave(userId: string): Promise<{ family: { id: string; name: string } }> {
    const family = await this.prisma.$transaction(async (tx) => {
      const me = await this.myMembershipLocked(tx, userId);
      if (me.role === 'owner') {
        throw new ConflictException({
          code: 'owner_must_transfer',
          message: 'Владелец не может выйти — сначала передайте права другому участнику',
        });
      }
      await dropMembership(tx, me);
      return createSoloFamily(tx, userId);
    });
    await this.stale.markStale([userId]);
    return { family };
  }

  async transferOwnership(actorId: string, targetUserId: string): Promise<void> {
    if (actorId === targetUserId) {
      throw new BadRequestException({
        code: 'cannot_transfer_to_self',
        message: 'Вы уже владелец',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const me = await this.requireOwnerLocked(tx, actorId);
      const target = await tx.membership.findFirst({
        where: { familyId: me.familyId, userId: targetUserId, user: { deletedAt: null } },
      });
      if (!target) {
        throw new NotFoundException({ code: 'not_found', message: 'Member not found' });
      }
      await tx.membership.update({ where: { id: target.id }, data: { role: 'owner' } });
      await tx.membership.update({ where: { id: me.id }, data: { role: 'parent' } });
    });
    await this.stale.markStale([actorId, targetUserId]);
  }
}
