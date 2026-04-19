import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GLITCHTIP_INTERNAL_URL = 'http://glitchtip-web:8000';

export async function POST(request: Request): Promise<Response> {
  const envelope = await request.text();
  if (!envelope) {
    return NextResponse.json({ error: 'empty envelope' }, { status: 400 });
  }

  let header: { dsn?: string };
  try {
    const firstLine = envelope.split('\n', 1)[0];
    header = JSON.parse(firstLine);
  } catch {
    return NextResponse.json({ error: 'invalid envelope header' }, { status: 400 });
  }

  const expectedDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!expectedDsn || header.dsn !== expectedDsn) {
    return NextResponse.json({ error: 'dsn mismatch' }, { status: 400 });
  }

  const projectIdMatch = expectedDsn.match(/\/(\d+)$/);
  const projectId = projectIdMatch?.[1];
  if (!projectId) {
    return NextResponse.json({ error: 'cannot extract project id' }, { status: 500 });
  }

  const upstream = `${GLITCHTIP_INTERNAL_URL}/api/${projectId}/envelope/`;
  try {
    await fetch(upstream, {
      method: 'POST',
      body: envelope,
      headers: { 'content-type': 'application/x-sentry-envelope' },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sentry-tunnel] upstream error', err);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
