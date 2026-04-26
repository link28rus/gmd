import { NextResponse } from 'next/server';

// v0.38 Phase 6.1: proxy public иконок приложений.
// Бэкенд отдаёт image/png по sha256 (content-addressable, immutable cache).
// Браузер ходит сюда чтобы избежать CORS и разных доменов dev/prod.
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3001';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sha256: string }> },
): Promise<NextResponse> {
  const { sha256 } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return new NextResponse('not found', { status: 404 });
  }
  const r = await fetch(`${BACKEND_URL}/app-icons/${sha256}`, {
    // Иконка immutable — кэшируем агрессивно.
    next: { revalidate: 31_536_000 },
  });
  if (!r.ok) {
    return new NextResponse('not found', { status: r.status });
  }
  const buf = await r.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
