import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getBearer, unauthorizedResponse, proxyResponse } from '@/app/api/children/_helpers';
import { backend } from '@/lib/backend';

const QuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  order: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().min(1).max(2000).default(2000),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
    order: url.searchParams.get('order') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid_query', message: parsed.error.message } },
      { status: 400 },
    );
  }

  // v0.63.0: карта дня рисует очищенный сервером трек (без грубых точек и
  // телепортов, стоянки свёрнуты в маркер) — тот же, что у поездок и
  // приложения родителя. Ответ отдаём в прежнем формате { items, nextCursor }.
  const { id } = await params;
  const qs = new URLSearchParams({ from: parsed.data.from, to: parsed.data.to });
  const r = await backend<TrackBody>(
    'GET',
    `/children/${encodeURIComponent(id)}/track?${qs.toString()}`,
    undefined,
    token,
  );
  if (r.status !== 200 || !r.body) return proxyResponse(r);
  const track = r.body;
  return NextResponse.json({
    items: track.points.map((p) => ({ ...p, accuracy: null, speed: null })),
    nextCursor: null,
    stays: track.stays,
  });
}

interface TrackBody {
  points: Array<{ lat: number; lon: number; recordedAt: string }>;
  stays: Array<{ lat: number; lon: number; from: string; to: string }>;
}
