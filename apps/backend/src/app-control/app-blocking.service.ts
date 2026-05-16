import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { AppRule, AppRuleMode, AppRuleSource, BlockSession } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';

/**
 * Phase 6.2 (v0.39) — App Blocking Core.
 * См. docs/superpowers/specs/2026-04-26-gmd-phase6-app-control.md §4-6.
 *
 * Модель блокировки: whitelist + глобальный таймер.
 *   - BlockSession{durationMin} активирует «всё блокируется кроме whitelist'а»
 *     на child-устройстве.
 *   - Whitelist = AppRule{mode=ALWAYS_ALLOWED} (явный родительский opt-out)
 *     ∪ SYSTEM_DEFAULT (резолвятся child'ом, dialer/sms/camera/contacts/settings)
 *     ∪ HARDCODED (наш app + MAX, зашиты в backend).
 *
 * FCM-доставка: BLOCK_APPS / UNBLOCK_APPS / SYNC_RULES — high-priority data
 * messages. При падении FCM child всё равно подтянет через poll-эндпоинты
 * GET /child/active-block и GET /child/app-rules (раз в час либо при старте app).
 *
 * OnModuleInit cleanup: при старте бэка переводим в EXPIRED все ACTIVE сессии,
 * у которых endsAt <= now. pg_cron делает то же раз в минуту (см. миграцию
 * 20260426170000), это страховка от gap'а между shutdown и cron tick.
 */
@Injectable()
export class AppBlockingService implements OnModuleInit {
  private readonly logger = new Logger(AppBlockingService.name);

  // Зашитый в backend всегда-allowed список. Не хранится в БД (см. комментарий
  // в schema.prisma на enum AppRuleSource). Резолвится на чтении.
  // - наш child app — иначе родитель не сможет принять команду «снять блок»
  // - MAX (мессенджер ru.oneme.app, пока не используется массово, но добавлен
  //   на случай если ребёнок захочет связаться с родителем во время блокировки)
  static readonly HARDCODED_ALLOWED = ['ru.link28rus.gmd.child', 'ru.oneme.app'] as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FcmService) private readonly fcm: FcmService,
  ) {}

  /**
   * При старте: добиваем все ACTIVE сессии с истёкшим endsAt в EXPIRED.
   * Без этого после рестарта бэк не отправил бы UNBLOCK_APPS на child, и хотя
   * сам child локально снимет блок (он тоже сравнивает endsAt < now), парент
   * увидел бы залипшую «активную» сессию.
   */
  async onModuleInit(): Promise<void> {
    try {
      const now = new Date();
      const result = await this.prisma.blockSession.updateMany({
        where: { state: 'ACTIVE', endsAt: { lte: now } },
        data: { state: 'EXPIRED', endedAt: now, endReason: 'EXPIRED' },
      });
      if (result.count > 0) {
        this.logger.warn(`startup cleanup: expired ${result.count} stale block-session(s)`);
      } else {
        this.logger.log('startup cleanup: no stale block-sessions');
      }
    } catch (err) {
      this.logger.error(`startup cleanup failed: ${String(err)}`);
    }
  }

  // ─── BlockSessions: parent-side ─────────────────────────────────────────

  /**
   * Создать BlockSession{state=ACTIVE} на child-устройстве.
   *
   * Контракт:
   *   - durationMin валидируется DTO (5..1440), здесь принимаем как есть
   *   - childDeviceId резолвится из childId (берём не-revoked устройство)
   *   - если у child уже есть state=ACTIVE сессия (даже с истёкшим endsAt) —
   *     отказываем 409 session_already_active. Сначала надо явно завершить
   *     (DELETE) или дождаться pg_cron (но пользователь не должен ждать).
   *   - после INSERT шлём FCM BLOCK_APPS{sessionId, endsAt}; на FCM disabled /
   *     network failure — без проблем, child подтянет через GET /child/active-block.
   */
  async createSession(params: {
    childId: string;
    createdByUserId: string;
    durationMin: number;
  }): Promise<{ sessionId: string; startedAt: Date; endsAt: Date }> {
    const device = await this.prisma.childDevice.findFirst({
      where: { childId: params.childId, revokedAt: null },
      select: { id: true, fcmToken: true, rustorePushToken: true },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'no_active_device',
        message: 'Child has no active device',
      });
    }

    const existing = await this.prisma.blockSession.findFirst({
      where: { childDeviceId: device.id, state: 'ACTIVE' },
      select: { id: true, endsAt: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'session_already_active',
        message: 'Another block session is already active for this child',
        sessionId: existing.id,
        endsAt: existing.endsAt.toISOString(),
      });
    }

    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + params.durationMin * 60_000);

    const session = await this.prisma.blockSession.create({
      data: {
        childDeviceId: device.id,
        createdByUserId: params.createdByUserId,
        state: 'ACTIVE',
        startedAt,
        endsAt,
      },
    });

    // FCM fire-and-forget. Если token null или FCM disabled — child через poll
    // (GET /child/active-block) подтянет в ближайший цикл.
    void this.fcm
      .sendHybridDataMessage(
        device.id,
        { fcmToken: device.fcmToken, rustorePushToken: device.rustorePushToken },
        {
          type: 'BLOCK_APPS',
          sessionId: session.id,
          endsAt: endsAt.toISOString(),
        },
      )
      .catch((err) => this.logger.warn(`push BLOCK_APPS failed for ${device.id}: ${String(err)}`));

    this.logger.log(
      `block-session created id=${session.id} child=${params.childId} duration=${params.durationMin}min`,
    );
    return { sessionId: session.id, startedAt, endsAt };
  }

  /**
   * Завершить активную сессию (parent явно нажал «Снять блок»).
   * Идемпотентен: повторный DELETE на уже ENDED сессии возвращает 204.
   */
  async stopSession(params: {
    childId: string;
    sessionId: string;
    stoppedByUserId: string;
  }): Promise<void> {
    const session = await this.prisma.blockSession.findUnique({
      where: { id: params.sessionId },
      select: {
        id: true,
        childDeviceId: true,
        state: true,
        childDevice: { select: { childId: true, fcmToken: true, rustorePushToken: true } },
      },
    });
    if (!session) {
      throw new NotFoundException({
        code: 'session_not_found',
        message: 'Block session not found',
      });
    }
    if (session.childDevice.childId !== params.childId) {
      // Защита от попытки stop'нуть чужую сессию через подмену childId в URL.
      throw new ForbiddenException({ code: 'session_belongs_to_other_child' });
    }
    if (session.state !== 'ACTIVE') {
      // Уже ENDED/EXPIRED — идемпотентно ничего не делаем.
      return;
    }

    await this.prisma.blockSession.update({
      where: { id: session.id },
      data: { state: 'ENDED', endedAt: new Date(), endReason: 'PARENT_STOPPED' },
    });

    void this.fcm
      .sendHybridDataMessage(
        session.childDeviceId,
        {
          fcmToken: session.childDevice.fcmToken,
          rustorePushToken: session.childDevice.rustorePushToken,
        },
        {
          type: 'UNBLOCK_APPS',
          sessionId: session.id,
        },
      )
      .catch((err) =>
        this.logger.warn(`push UNBLOCK_APPS failed for ${session.childDeviceId}: ${String(err)}`),
      );

    this.logger.log(
      `block-session stopped id=${session.id} child=${params.childId} by user=${params.stoppedByUserId}`,
    );
  }

  /**
   * Активная сессия для child-устройства (для UI парента — показать счётчик
   * «осталось 1 ч 59 мин»). Возвращает null если нет активной.
   * Если у сессии endsAt уже прошёл — авто-помечаем как EXPIRED on-the-fly,
   * чтобы UI не получил «активную» с истёкшим временем (защита если cron не
   * успел).
   */
  async getActiveSession(childId: string): Promise<BlockSession | null> {
    const device = await this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
      select: { id: true },
    });
    if (!device) return null;

    const session = await this.prisma.blockSession.findFirst({
      where: { childDeviceId: device.id, state: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    if (!session) return null;

    if (session.endsAt.getTime() <= Date.now()) {
      await this.prisma.blockSession.update({
        where: { id: session.id },
        data: { state: 'EXPIRED', endedAt: new Date(), endReason: 'EXPIRED' },
      });
      this.logger.log(`active session ${session.id} found expired on-read, auto-marked EXPIRED`);
      // Для UI парента «нет активной сессии» — она только что истекла.
      return null;
    }
    return session;
  }

  // ─── AppRules: parent-side ──────────────────────────────────────────────

  /**
   * UPSERT правила {childDeviceId × packageName} с source=PARENT.
   * Если родитель явно настроил DEFAULT — это означает «откат к default
   * поведению», правило с source=PARENT в БД сохраняем (не удаляем), чтобы
   * автоматический SYSTEM_DEFAULT не мог вернуть его в whitelist.
   *
   * После UPSERT шлём FCM SYNC_RULES — child делает GET /child/app-rules
   * и переписывает локальную таблицу.
   */
  async upsertParentRule(params: {
    childId: string;
    packageName: string;
    mode: AppRuleMode;
  }): Promise<AppRule> {
    const device = await this.prisma.childDevice.findFirst({
      where: { childId: params.childId, revokedAt: null },
      select: { id: true, fcmToken: true, rustorePushToken: true },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'no_active_device',
        message: 'Child has no active device',
      });
    }

    const rule = await this.prisma.appRule.upsert({
      where: {
        childDeviceId_packageName: { childDeviceId: device.id, packageName: params.packageName },
      },
      create: {
        childDeviceId: device.id,
        packageName: params.packageName,
        mode: params.mode,
        source: 'PARENT',
      },
      update: {
        mode: params.mode,
        source: 'PARENT', // если раньше было SYSTEM_DEFAULT — поднимаем до PARENT
      },
    });

    void this.fcm
      .sendHybridDataMessage(
        device.id,
        { fcmToken: device.fcmToken, rustorePushToken: device.rustorePushToken },
        { type: 'SYNC_RULES' },
      )
      .catch((err) => this.logger.warn(`push SYNC_RULES failed for ${device.id}: ${String(err)}`));

    return rule;
  }

  /**
   * UPSERT system-default правил из payload child'а (резолвлено через
   * TelecomManager / Telephony.Sms / PackageManager на устройстве).
   *
   * Контракт:
   *   - source=SYSTEM_DEFAULT, mode=ALWAYS_ALLOWED для каждого packageName в payload
   *   - НЕ перезаписывает существующие PARENT-правила (родитель сильнее)
   *   - Возвращает количество вставленных + обновлённых рекордов
   */
  async upsertSystemDefaults(
    childDeviceId: string,
    packages: string[],
  ): Promise<{ count: number }> {
    if (packages.length === 0) return { count: 0 };

    // Берём существующие PARENT-правила для этих packages — их не трогаем.
    const existingParent = await this.prisma.appRule.findMany({
      where: {
        childDeviceId,
        packageName: { in: packages },
        source: 'PARENT',
      },
      select: { packageName: true },
    });
    const skipSet = new Set(existingParent.map((r) => r.packageName));
    const toUpsert = packages.filter((p) => !skipSet.has(p));

    let count = 0;
    for (const pkg of toUpsert) {
      await this.prisma.appRule.upsert({
        where: { childDeviceId_packageName: { childDeviceId, packageName: pkg } },
        create: {
          childDeviceId,
          packageName: pkg,
          mode: 'ALWAYS_ALLOWED',
          source: 'SYSTEM_DEFAULT',
        },
        update: {
          // SYSTEM_DEFAULT идемпотентно перезаписываем (вдруг ребёнок поменял
          // default dialer — старый рез нужно обновить mode/source).
          mode: 'ALWAYS_ALLOWED',
          source: 'SYSTEM_DEFAULT',
        },
      });
      count++;
    }
    return { count };
  }

  // ─── Read для child (GET /child/app-rules, GET /child/active-block) ─────

  /**
   * Список effective-rules для child: HARDCODED + в БД (PARENT + SYSTEM_DEFAULT).
   * HARDCODED идут с приоритетом — даже если родитель попытается выставить
   * mode=ALWAYS_BLOCKED для нашего app, отдаём ALWAYS_ALLOWED.
   */
  async listEffectiveRules(
    childDeviceId: string,
  ): Promise<Array<{ packageName: string; mode: AppRuleMode; source: AppRuleSource }>> {
    const dbRules = await this.prisma.appRule.findMany({
      where: { childDeviceId },
      select: { packageName: true, mode: true, source: true },
    });

    const hardcodedSet = new Set(AppBlockingService.HARDCODED_ALLOWED);
    const out: Array<{ packageName: string; mode: AppRuleMode; source: AppRuleSource }> = [];

    // Сначала hardcoded
    for (const pkg of AppBlockingService.HARDCODED_ALLOWED) {
      out.push({ packageName: pkg, mode: 'ALWAYS_ALLOWED', source: 'HARDCODED' });
    }

    // Затем DB-правила, исключая hardcoded (если родитель/system пытались
    // их перезаписать — игнорируем).
    for (const r of dbRules) {
      if (hardcodedSet.has(r.packageName as (typeof AppBlockingService.HARDCODED_ALLOWED)[number]))
        continue;
      out.push(r);
    }

    return out;
  }

  /**
   * Список правил per-(child × packageName) для UI парента: для каждого
   * packageName из installed-apps возвращаем (mode, source) с учётом
   * HARDCODED-приоритета и пометкой «editable» (нельзя менять hardcoded).
   *
   * Endpoint /family/children/:id/app-control/app-rules возвращает только
   * правила, явно сохранённые (PARENT + SYSTEM_DEFAULT) — UI комбинирует с
   * списком installed-apps на клиенте.
   */
  async listParentRules(
    childDeviceId: string,
  ): Promise<Array<{ packageName: string; mode: AppRuleMode; source: AppRuleSource }>> {
    const rules = await this.prisma.appRule.findMany({
      where: { childDeviceId },
      orderBy: { packageName: 'asc' },
      select: { packageName: true, mode: true, source: true },
    });
    return rules;
  }

  // ─── Helper для других сервисов ─────────────────────────────────────────

  /**
   * v0.51.1 (task #68): snapshot push-токенов устройства для регрессии latency.
   * Используется в GET /child/active-block чтобы вернуть `forceFcmRefresh=true`
   * когда `fcmToken IS NULL` — сигнал child'у re-register'нуть токен через
   * `FcmTokenRefreshWorker`. Без этого orphaned-token после app-update через
   * RuStore лечится только когда ребёнок откроет app (мог не открывать сутками).
   */
  async getDeviceTokensSnapshot(
    childDeviceId: string,
  ): Promise<{ fcmToken: string | null; rustorePushToken: string | null } | null> {
    return this.prisma.childDevice.findUnique({
      where: { id: childDeviceId },
      select: { fcmToken: true, rustorePushToken: true },
    });
  }

  /**
   * Утилита для child API: проверить активную блокировку по deviceId
   * (без round-trip через childId). Используется в GET /child/active-block.
   */
  async getActiveSessionByDevice(childDeviceId: string): Promise<BlockSession | null> {
    const session = await this.prisma.blockSession.findFirst({
      where: { childDeviceId, state: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    if (!session) return null;
    if (session.endsAt.getTime() <= Date.now()) {
      await this.prisma.blockSession.update({
        where: { id: session.id },
        data: { state: 'EXPIRED', endedAt: new Date(), endReason: 'EXPIRED' },
      });
      return null;
    }
    return session;
  }
}
