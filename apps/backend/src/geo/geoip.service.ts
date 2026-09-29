import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { join } from 'node:path';
import maxmind from 'maxmind';

/**
 * Запись базы DB-IP City Lite с зеркала sapics/ip-location-db. Схема у зеркала
 * своя, не GeoLite2: плоские поля, названия городов на английском.
 */
interface DbipCityRecord {
  city?: string;
  state1?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
}

/** Минимум от maxmind.Reader: типы пакета требуют схему GeoLite2, у зеркала своя. */
export interface DbReader {
  get(ip: string): unknown;
}

export interface IpCenter {
  lat: number;
  lon: number;
  city: string | null;
  countryCode: string | null;
  attribution: string;
}

export const DBIP_ATTRIBUTION = 'IP Geolocation by DB-IP';

// Приватные, служебные и зарезервированные сети — по ним город не ищем.
const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv6');
}

/** Адрес без IPv4-mapped префикса (::ffff:1.2.3.4 → 1.2.3.4); не IP — null. */
export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const ip = raw.trim().replace(/^::ffff:/i, '');
  return isIP(ip) ? ip : null;
}

export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !NON_PUBLIC.check(ip, 'ipv4');
  if (family === 6) return !NON_PUBLIC.check(ip, 'ipv6');
  return false;
}

/**
 * v0.64.0: город по IP из локальной базы DB-IP City Lite (CC BY 4.0) — IP
 * никуда не уходит (152-ФЗ). Файлы кладёт systemd-таймер на хосте в каталог,
 * смонтированный в контейнер :ro; watchForUpdates подхватывает замену через mv.
 * Нет файлов — сервис работает, lookup отдаёт null.
 */
@Injectable()
export class GeoIpService implements OnModuleInit {
  private readonly logger = new Logger(GeoIpService.name);
  private readonly dir = process.env.GEOIP_DIR || '/srv/geoip';
  private v4: DbReader | null = null;
  private v6: DbReader | null = null;

  async onModuleInit(): Promise<void> {
    this.v4 = await this.openDb('dbip-city-ipv4.mmdb');
    this.v6 = await this.openDb('dbip-city-ipv6.mmdb');
  }

  private async openDb(file: string): Promise<DbReader | null> {
    const path = join(this.dir, file);
    if (!existsSync(path)) {
      this.logger.warn(`GeoIP: нет файла ${path} — город по IP недоступен`);
      return null;
    }
    try {
      const reader: DbReader = await maxmind.open(path, {
        watchForUpdates: true,
        watchForUpdatesNonPersistent: true,
        watchForUpdatesHook: () => this.logger.log(`GeoIP: база ${file} обновлена`),
      });
      this.logger.log(`GeoIP: база ${file} загружена`);
      return reader;
    } catch (e) {
      this.logger.error(`GeoIP: не удалось открыть ${path}: ${String(e)}`);
      return null;
    }
  }

  /** Центр города по IP; приватный адрес, нет в базе или база не загружена — null. */
  lookup(rawIp: string | undefined | null): IpCenter | null {
    const ip = normalizeIp(rawIp);
    if (!ip || !isPublicIp(ip)) return null;
    const reader = isIP(ip) === 4 ? this.v4 : this.v6;
    if (!reader) return null;
    let rec: DbipCityRecord | null;
    try {
      rec = reader.get(ip) as DbipCityRecord | null;
    } catch {
      return null;
    }
    if (!rec || typeof rec.latitude !== 'number' || typeof rec.longitude !== 'number') {
      return null;
    }
    return {
      lat: rec.latitude,
      lon: rec.longitude,
      city: rec.city || rec.state1 || null,
      countryCode: rec.country_code || null,
      attribution: DBIP_ATTRIBUTION,
    };
  }

  /** Для тестов: подставить уже открытые базы. */
  setReaders(v4: DbReader | null, v6: DbReader | null): void {
    this.v4 = v4;
    this.v6 = v6;
  }
}
