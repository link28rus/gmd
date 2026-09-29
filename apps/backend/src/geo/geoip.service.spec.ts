import { existsSync } from 'node:fs';
import maxmind from 'maxmind';
import { GeoIpService, isPublicIp, normalizeIp } from './geoip.service';

describe('GeoIP: адреса', () => {
  it('normalizeIp снимает IPv4-mapped префикс и отбрасывает мусор', () => {
    expect(normalizeIp('::ffff:8.8.8.8')).toBe('8.8.8.8');
    expect(normalizeIp(' 2a00:1450::1 ')).toBe('2a00:1450::1');
    expect(normalizeIp('не ip')).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });

  it.each([
    '10.1.2.3',
    '172.18.0.5',
    '192.168.1.111',
    '127.0.0.1',
    '100.64.1.1',
    '169.254.0.1',
    '::1',
    'fd00::1',
    'fe80::1',
  ])('%s — не публичный', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '77.88.8.8', '2a00:1450:4010::1'])('%s — публичный', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });
});

describe('GeoIpService.lookup', () => {
  it('без базы — null, а не исключение', () => {
    const svc = new GeoIpService();
    expect(svc.lookup('8.8.8.8')).toBeNull();
  });

  it('приватный адрес — null, в базу не ходит', () => {
    const svc = new GeoIpService();
    const get = jest.fn();
    svc.setReaders({ get } as never, null);
    expect(svc.lookup('192.168.1.10')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('запись зеркала DB-IP → центр города с атрибуцией', () => {
    const svc = new GeoIpService();
    svc.setReaders(
      {
        get: () => ({
          city: 'Khabarovsk',
          state1: 'Khabarovsk Krai',
          country_code: 'RU',
          latitude: 48.48,
          longitude: 135.07,
        }),
      } as never,
      null,
    );
    expect(svc.lookup('::ffff:95.104.1.1')).toEqual({
      lat: 48.48,
      lon: 135.07,
      city: 'Khabarovsk',
      countryCode: 'RU',
      attribution: 'IP Geolocation by DB-IP',
    });
  });

  it('IPv6 без базы v6 — null', () => {
    const svc = new GeoIpService();
    svc.setReaders({ get: () => ({ latitude: 1, longitude: 1 }) } as never, null);
    expect(svc.lookup('2a00:1450:4010::1')).toBeNull();
  });

  // Живая база — если скачана локально (GEOIP_TEST_DB=путь к dbip-city-ipv4.mmdb).
  const realDb = process.env.GEOIP_TEST_DB;
  (realDb && existsSync(realDb) ? it : it.skip)('настоящая база: 77.88.8.8 → Россия', async () => {
    const svc = new GeoIpService();
    svc.setReaders(await maxmind.open(realDb as string), null);
    const c = svc.lookup('77.88.8.8');
    expect(c?.countryCode).toBe('RU');
    expect(typeof c?.lat).toBe('number');
  });
});
