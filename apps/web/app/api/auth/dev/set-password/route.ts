import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://backend:3001';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = req.headers.get('x-auth-dev-secret') ?? '';
  const body = (await req.json().catch(() => ({}))) as unknown;
  const r = await fetch(`${BACKEND}/auth/dev/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Dev-Secret': secret },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  const json: unknown = text ? JSON.parse(text) : null;
  return NextResponse.json(json ?? {}, { status: r.status });
}
