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

export async function GET(req: NextRequest) {
  // У Яндекса один ключ поддерживает JavaScript API + HTTP Геокодер (сервис
  // "JavaScript API и HTTP Геокодер"). Если YANDEX_GEOCODER_API_KEY отдельно
  // не задан — используем тот же, что и для карт.
  const apiKey = process.env.YANDEX_GEOCODER_API_KEY ?? process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { code: 'geocoder_not_configured', message: 'Yandex API key missing' },
      { status: 503 },
    );
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

  // Ключ в кабинете Яндекса ограничен по HTTP Referer (домен приложения).
  // Без заголовка Referer запросы с backend'а получают 403.
  const referer = process.env.PUBLIC_SITE_URL ?? 'https://gmd.link28rus.ru/';

  const res = await fetch(`${YANDEX_GEOCODER_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json', Referer: referer },
  });
  if (!res.ok) {
    return NextResponse.json(
      { code: 'geocoder_upstream_error', status: res.status },
      { status: 502 },
    );
  }
  const data: YandexResponse = await res.json();
  const items = (data.response?.GeoObjectCollection?.featureMember ?? []).map((m) => {
    const [lon, lat] = m.GeoObject.Point.pos.split(' ').map(Number);
    return {
      name: m.GeoObject.name,
      description: m.GeoObject.description ?? '',
      lat,
      lon,
    };
  });
  return NextResponse.json({ items });
}
