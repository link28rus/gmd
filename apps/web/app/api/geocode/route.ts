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
  const apiKey = process.env.YANDEX_GEOCODER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { code: 'geocoder_not_configured', message: 'YANDEX_GEOCODER_API_KEY missing' },
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

  const res = await fetch(`${YANDEX_GEOCODER_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
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
