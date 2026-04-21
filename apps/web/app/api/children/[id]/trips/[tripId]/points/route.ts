import type { NextRequest } from 'next/server';
import { getBearer, unauthorizedResponse, proxyResponse } from '@/app/api/children/_helpers';
import { backend } from '@/lib/backend';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tripId: string }> },
) {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();
  const { id, tripId } = await params;
  const r = await backend(
    'GET',
    `/children/${encodeURIComponent(id)}/trips/${encodeURIComponent(tripId)}/points`,
    undefined,
    token,
  );
  return proxyResponse(r);
}
