import { NextResponse, type NextRequest } from 'next/server';
import { getBearer, proxy, unauthorizedResponse } from '../../_helpers';

// Фото ребёнка — ПДн: GET только под Bearer родителя, байты проксируем как
// есть (без JSON-разбора). PUT/DELETE — обычный JSON-прокси.
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3001';

const PASS_HEADERS = ['content-type', 'cache-control', 'etag'] as const;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();

  const ifNoneMatch = req.headers.get('if-none-match');
  const r = await fetch(`${BACKEND_URL}/family/children/${encodeURIComponent(id)}/avatar`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
    },
    cache: 'no-store',
  });

  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = r.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (r.status === 304) {
    return new NextResponse(null, { status: 304, headers });
  }
  if (!r.ok) {
    // Ошибки backend — JSON ({error:{code,message}}), отдаём клиенту как есть.
    const text = await r.text();
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new NextResponse(text || null, { status: r.status, headers });
  }
  return new NextResponse(await r.arrayBuffer(), { status: r.status, headers });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  return proxy('PUT', `/family/children/${id}/avatar`, req, body);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('DELETE', `/family/children/${id}/avatar`, req);
}
