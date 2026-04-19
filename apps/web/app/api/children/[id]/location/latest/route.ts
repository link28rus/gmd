import type { NextRequest } from 'next/server';
import { getBearer, unauthorizedResponse, proxyResponse } from '@/app/api/children/_helpers';
import { backend } from '@/lib/backend';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();
  const { id } = await params;
  const r = await backend(
    'GET',
    `/children/${encodeURIComponent(id)}/location/latest`,
    undefined,
    token,
  );
  return proxyResponse(r);
}
