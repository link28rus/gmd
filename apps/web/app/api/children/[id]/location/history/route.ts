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

  const { id } = await params;
  const qs = new URLSearchParams({
    from: parsed.data.from,
    to: parsed.data.to,
    order: parsed.data.order,
    limit: String(parsed.data.limit),
  });
  const r = await backend(
    'GET',
    `/children/${encodeURIComponent(id)}/locations?${qs.toString()}`,
    undefined,
    token,
  );
  return proxyResponse(r);
}
