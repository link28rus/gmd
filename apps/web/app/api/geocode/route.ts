import { NextRequest, NextResponse } from 'next/server';

const YANDEX_GEOCODER_URL = 'https://geocode-maps.yandex.ru/1.x/';

interface YandexResponse {
  response?: {
    GeoObjectCollection?: {
      featureMember?: Array<{
        GeoObject: {
          name: string;
          description?: string;
          Point: { pos: string };
        };
      }>;
    };
  };
}

function errorJson(code: string, message: string, status: number): NextResponse {
  // Формат как у backend'а (`{ error: { code, message } }`) — apiFetch достаёт code.
  return NextResponse.json({ error: { code, message } }, { status });
}

/** «lon,lat» → строка для Yandex или null, если числа невалидны. */
function parseLl(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const [lon, lat] = parts.map((p) => Number(p.trim()));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return `${lon},${lat}`;
}

/** «dLon,dLat» → строка для Yandex или null; оба положительные и в пределах шара. */
function parseSpn(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const [dLon, dLat] = parts.map((p) => Number(p.trim()));
  if (!Number.isFinite(dLon) || !Number.isFinite(dLat)) return null;
  if (dLon <= 0 || dLat <= 0 || dLon > 360 || dLat > 180) return null;
  return `${dLon},${dLat}`;
}

export async function GET(req: NextRequest) {
  // Yandex HTTP Геокодер ключ — server-side only. После переезда карт на
  // OSM/leaflet старый NEXT_PUBLIC_YANDEX_MAPS_API_KEY больше не нужен;
  // геокодер требует отдельной настройки YANDEX_GEOCODER_API_KEY.
  const apiKey = process.env.YANDEX_GEOCODER_API_KEY;
  if (!apiKey) {
    return errorJson('geocoder_not_configured', 'Yandex API key missing', 503);
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ items: [] });
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    format: 'json',
    lang: 'ru_RU',
    geocode: q,
    results: '5',
  });

  // Смещение поиска к центру карты: ll + spn задают область, где результаты
  // приоритетнее (rspn по умолчанию 0 — искать и за её пределами тоже).
  // Невалидные значения молча отбрасываем — поиск работает и без смещения.
  const ll = parseLl(url.searchParams.get('ll'));
  if (ll) {
    params.set('ll', ll);
    const spn = parseSpn(url.searchParams.get('spn'));
    if (spn) params.set('spn', spn);
  }

  // Ключ в кабинете Яндекса ограничен по HTTP Referer (домен приложения).
  // Без заголовка Referer запросы с backend'а получают 403.
  const referer = process.env.PUBLIC_SITE_URL ?? 'https://periscop.pro/';

  let res: Response;
  try {
    res = await fetch(`${YANDEX_GEOCODER_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json', Referer: referer },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return errorJson('geocoder_unavailable', 'Yandex geocoder unreachable', 502);
  }
  if (!res.ok) {
    return errorJson('geocoder_upstream_error', `Yandex responded ${res.status}`, 502);
  }
  let data: YandexResponse;
  try {
    data = (await res.json()) as YandexResponse;
  } catch {
    return errorJson('geocoder_upstream_error', 'Invalid Yandex response', 502);
  }
  const items = (data.response?.GeoObjectCollection?.featureMember ?? [])
    .map((m) => {
      const [lon, lat] = m.GeoObject.Point.pos.split(' ').map(Number);
      return {
        name: m.GeoObject.name,
        description: m.GeoObject.description ?? '',
        lat,
        lon,
      };
    })
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon));
  return NextResponse.json({ items });
}
