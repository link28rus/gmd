import type { NextRequest } from 'next/server';
import { getBearer, unauthorizedResponse } from '../../../../children/_helpers';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3001';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();

  const { id } = await ctx.params;

  const upstream = await fetch(`${BACKEND_URL}/audio/sessions/${id}/events`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
    cache: 'no-store',
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return new Response(text || '{"error":{"code":"upstream_error"}}', {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
