import { NextResponse, type NextRequest } from 'next/server';
import { proxy } from '../../zones/_helpers';

/**
 * Только для dev: на проде Caddy шлёт /api/family/* прямо в backend (`handle_path /api/*`).
 * Catch-all для участников семьи (v0.71.0) и прочих /family/* без своего route handler.
 * Конкретные маршруты (`locations/latest`) приоритетнее catch-all — Next выбирает их сам.
 */

interface Ctx {
  params: Promise<{ path: string[] }>;
}

async function backendPath(req: NextRequest, ctx: Ctx): Promise<string> {
  const { path } = await ctx.params;
  const tail = path.map((p) => encodeURIComponent(p)).join('/');
  return `/family/${tail}${req.nextUrl.search}`;
}

/** Тело запроса как JSON; пустое тело → undefined. Невалидный JSON → null (ответим 400). */
async function readBody(req: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const text = await req.text();
  if (!text) return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function badJson(): NextResponse {
  return NextResponse.json(
    { error: { code: 'bad_request', message: 'Invalid JSON body' } },
    { status: 400 },
  );
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return proxy('GET', await backendPath(req, ctx), req);
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return proxy('DELETE', await backendPath(req, ctx), req);
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const b = await readBody(req);
  if (!b.ok) return badJson();
  return proxy('POST', await backendPath(req, ctx), req, b.body);
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const b = await readBody(req);
  if (!b.ok) return badJson();
  return proxy('PATCH', await backendPath(req, ctx), req, b.body);
}
