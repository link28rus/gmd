import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { DeviceCommandsService } from '../device-commands/device-commands.service';
import { AudioEvents } from './audio.events';
import type { TurnCreds } from './dto/audio.dto';

@Injectable()
export class AudioService {
  constructor(
    // Skeleton: зависимости будут использоваться в Task 7-9 (startSession, childReady, etc.)
    @Inject(PrismaService) protected readonly prisma: PrismaService,
    @Inject(AppSettingsService) protected readonly settings: AppSettingsService,
    @Inject(DeviceCommandsService) protected readonly commands: DeviceCommandsService,
    @Inject(AudioEvents) protected readonly events: AudioEvents,
  ) {}

  /**
   * RFC 5766 REST API for time-limited TURN creds.
   * username = "<unix_ts_expiry>:<session_id>"
   * password = base64(HMAC_SHA1(static-auth-secret, username))
   * coturn проверяет HMAC локально, БД для auth не нужна.
   *
   * Env: TURN_SHARED_SECRET (обязательно), TURN_PUBLIC_HOST (обязательно),
   * TURN_PUBLIC_PORT (default 3478).
   */
  generateTurnCreds(sessionId: string, ttlSec: number): TurnCreds {
    const secret = process.env.TURN_SHARED_SECRET;
    const host = process.env.TURN_PUBLIC_HOST;
    const port = process.env.TURN_PUBLIC_PORT ?? '3478';

    if (!secret) {
      throw new Error('TURN_SHARED_SECRET env variable must be configured');
    }
    if (!host) {
      throw new Error('TURN_PUBLIC_HOST env variable must be configured');
    }

    const expiry = Math.floor(Date.now() / 1000) + ttlSec;
    const username = `${expiry}:${sessionId}`;
    const password = createHmac('sha1', secret).update(username).digest('base64');

    return {
      url: `turn:${host}:${port}`,
      username,
      password,
      ttl: ttlSec,
    };
  }
}
