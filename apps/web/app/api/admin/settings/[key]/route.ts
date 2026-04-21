import { NextResponse, type NextRequest } from 'next/server';
import { getBearer, unauthorizedResponse } from '../../_helpers';
import { backend } from '@/lib/backend';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();
  const { key } = await params;
  const body = (await req.json()) as unknown;
  const r = await backend('PATCH', `/admin/settings/${encodeURIComponent(key)}`, body, token);
  return NextResponse.json(r.body ?? {}, { status: r.status });
}
