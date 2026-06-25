import { Injectable, Logger } from '@nestjs/common';
import type { WebSocket } from 'ws';

// Backpressure пороги (на каждого consumer'а):
// drop — потеряем кадр (для голоса прощаем короткий glitch);
// fail — terminate consumer'а с close-code, чтобы не упасть в OOM.
// 16kHz mono Opus ~32 kbps → 4 KB/сек → 512 KB ≈ 128 сек буфера? Нет: bufferedAmount —
// это уже отправленные через send() байты, ещё не вычерпанные TCP. На практике
// здоровый канал держит < 32 KB. 512 KB = тревожный порог, 2 MB = аварийный.
const BACKPRESSURE_DROP_BYTES = 512 * 1024;
const BACKPRESSURE_FAIL_BYTES = 2 * 1024 * 1024;

// ws.readyState значения (без хардкода '1' magic-number).
const WS_OPEN = 1;

export interface RelaySession {
  sessionId: string;
  producer: WebSocket | null;
  consumers: Set<WebSocket>;
  // wall-clock время последнего полученного фрейма от producer'а.
  // Watchdog по этому полю определяет «застрявшие» сессии.
  lastFrameTs: number;
  // Когда оба endpoint впервые сошлись — momentum для перехода PENDING→ACTIVE.
  activatedAt: number | null;
  totalFrames: number;
  dropCount: number;
}

export interface RelayCallbacks {
  /** Вызывается когда producer + хотя бы 1 consumer подключены к одной сессии. Idempotent в service. */
  onActivate: (sessionId: string) => Promise<void> | void;
  /** Вызывается из watchdog'а когда сессия idle > threshold. */
  onIdleExpire: (sessionId: string) => Promise<void> | void;
}

@Injectable()
export class AudioRelay {
  private readonly logger = new Logger(AudioRelay.name);
  private readonly sessions = new Map<string, RelaySession>();
  private callbacks: RelayCallbacks | null = null;

  setCallbacks(cb: RelayCallbacks): void {
    this.callbacks = cb;
  }

  /** Сколько сессий в памяти прямо сейчас (для метрик/тестов). */
  size(): number {
    return this.sessions.size;
  }

  /**
   * v0.51.x (task #69): set всех sessionId, которые сейчас живы в relay-map
   * (есть хотя бы один открытый WS-конец). Используется в
   * [AudioService.cleanupOrphans] чтобы вычислить orphan-сессии = state ∈
   * (PENDING/READY/ACTIVE) в БД, но отсутствуют в relay → оба WS отвалились
   * → надо принудительно закрыть сессию в БД и послать STOP_AUDIO на child.
   */
  activeSessionIds(): Set<string> {
    return new Set(this.sessions.keys());
  }

  /**
   * DIAG (task #73): краткая статистика по всем живым relay-сессиям для
   * периодического лога в watchdog'е. Показывает, идут ли фреймы (totalFrames
   * растёт между тиками) и есть ли consumers, не дожидаясь terminate.
   */
  statsSnapshot(): Array<{
    sessionId: string;
    frames: number;
    drops: number;
    consumers: number;
    hasProducer: boolean;
    sinceLastFrameMs: number;
  }> {
    const now = Date.now();
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      frames: s.totalFrames,
      drops: s.dropCount,
      consumers: s.consumers.size,
      hasProducer: s.producer !== null,
      sinceLastFrameMs: now - s.lastFrameTs,
    }));
  }

  /** Снимок состояния сессии. Только для тестов / админ-метрик. */
  snapshot(sessionId: string): Readonly<RelaySession> | null {
    return this.sessions.get(sessionId) ?? null;
  }

  attachProducer(sessionId: string, ws: WebSocket): void {
    const s = this.getOrCreate(sessionId);
    if (s.producer && s.producer !== ws) {
      // Дубль: child переподключился (network blip). Старого закрываем — новые
      // фреймы пойдут через нового. Лучше так, чем мерджить два потока.
      this.logger.warn(`session ${sessionId}: producer reconnected, closing old socket`);
      try {
        s.producer.close(4002, 'replaced_by_new_producer');
      } catch {
        /* ignore */
      }
    }
    s.producer = ws;
    s.lastFrameTs = Date.now();
    this.maybeActivate(s);
  }

  attachConsumer(sessionId: string, ws: WebSocket): void {
    const s = this.getOrCreate(sessionId);
    s.consumers.add(ws);
    this.maybeActivate(s);
  }

  /**
   * Снять клиента из сессии. Вызывается из gateway на ws.close.
   * Если ушёл producer — рвём всех consumer'ов (поток оборван, держать смысла нет).
   * Если ушёл последний consumer и producer ещё есть — оставляем сессию (consumer может
   * переподключиться). Если ушли все — удаляем из памяти.
   */
  detach(sessionId: string, ws: WebSocket): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.producer === ws) {
      // DIAG (task #73): сколько фреймов успел прислать producer до отвала.
      // totalFrames=0 → producer подключился, но не отдал ни одного аудио-кадра
      // (mic не стартовал / headless record молчит / engine убит STOP'ом).
      const idleMs = Date.now() - s.lastFrameTs;
      this.logger.warn(
        `session ${sessionId}: producer detached — totalFrames=${s.totalFrames} ` +
          `drops=${s.dropCount} consumers=${s.consumers.size} sinceLastFrameMs=${idleMs}`,
      );
      s.producer = null;
      // Producer ушёл — consumer'ы тоже не могут получать. Закрываем их явно.
      for (const c of s.consumers) {
        if (c.readyState === WS_OPEN) {
          try {
            c.close(4003, 'producer_gone');
          } catch {
            /* ignore */
          }
        }
      }
      s.consumers.clear();
    } else if (s.consumers.has(ws)) {
      s.consumers.delete(ws);
    }
    if (!s.producer && s.consumers.size === 0) {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Получили binary-фрейм от producer'а — раздать consumer'ам.
   * На каждом consumer проверяем bufferedAmount → drop / fail если переполнен.
   * Frame передаётся as-is, gateway отвечает за TLV (мы здесь — тупой relay).
   */
  publishFrame(sessionId: string, frame: Buffer): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.lastFrameTs = Date.now();
    s.totalFrames++;

    // DIAG (task #73): первый фрейм = producer реально начал слать аудио;
    // периодический лог = поток жив. Раскрывает «ACTIVE но звука нет» —
    // producer молчит (нет первого фрейма) vs consumer не играет (фреймы идут).
    if (s.totalFrames === 1 || s.totalFrames % 250 === 0) {
      this.logger.log(
        `session ${sessionId}: producer frames=${s.totalFrames} consumers=${s.consumers.size} drops=${s.dropCount}`,
      );
    }

    if (s.consumers.size === 0) return;

    const dead: WebSocket[] = [];
    for (const consumer of s.consumers) {
      if (consumer.readyState !== WS_OPEN) {
        dead.push(consumer);
        continue;
      }
      const buffered = consumer.bufferedAmount;
      if (buffered > BACKPRESSURE_FAIL_BYTES) {
        this.logger.warn(
          `session ${sessionId}: consumer overflow (${buffered} B buffered), terminating`,
        );
        try {
          consumer.close(4004, 'backpressure_overflow');
        } catch {
          /* ignore */
        }
        dead.push(consumer);
      } else if (buffered > BACKPRESSURE_DROP_BYTES) {
        s.dropCount++;
        if (s.dropCount % 50 === 1) {
          this.logger.warn(
            `session ${sessionId}: backpressure drop ` +
              `(${buffered} B buffered, ${s.dropCount} total drops)`,
          );
        }
      } else {
        consumer.send(frame, { binary: true });
      }
    }
    for (const c of dead) s.consumers.delete(c);
    // Если все consumer'ы умерли — оставляем producer (вдруг parent переподключится).
    // Watchdog убьёт сессию по idle если никто не вернётся за 90с.
  }

  /**
   * Найти сессии где poslední кадр от producer был дольше maxIdleMs назад.
   * Гoвoрит «эту сессию пора закрыть как stuck».
   */
  findIdleSessions(maxIdleMs: number): string[] {
    const cutoff = Date.now() - maxIdleMs;
    const result: string[] = [];
    for (const [id, s] of this.sessions) {
      if (s.lastFrameTs < cutoff) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * Принудительно закрыть все сокеты сессии и удалить из памяти.
   * Вызывается из service'а при parentStop / endSession / watchdog.
   */
  terminate(sessionId: string, code: number, reason: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    // DIAG (task #73): итог сессии при принудительном закрытии.
    this.logger.warn(
      `session ${sessionId}: terminate code=${code} reason=${reason} ` +
        `totalFrames=${s.totalFrames} drops=${s.dropCount} consumers=${s.consumers.size}`,
    );
    if (s.producer && s.producer.readyState === WS_OPEN) {
      try {
        s.producer.close(code, reason);
      } catch {
        /* ignore */
      }
    }
    for (const c of s.consumers) {
      if (c.readyState === WS_OPEN) {
        try {
          c.close(code, reason);
        } catch {
          /* ignore */
        }
      }
    }
    this.sessions.delete(sessionId);
  }

  /** Удалить только запись из карты, без закрытия сокетов. Для тестов. */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private getOrCreate(sessionId: string): RelaySession {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = {
        sessionId,
        producer: null,
        consumers: new Set(),
        lastFrameTs: Date.now(),
        activatedAt: null,
        totalFrames: 0,
        dropCount: 0,
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  private maybeActivate(s: RelaySession): void {
    if (s.activatedAt) return;
    if (!s.producer || s.consumers.size === 0) return;
    s.activatedAt = Date.now();
    if (this.callbacks) {
      Promise.resolve(this.callbacks.onActivate(s.sessionId)).catch((err) => {
        this.logger.error(`onActivate failed for ${s.sessionId}: ${String(err)}`);
      });
    }
  }
}
