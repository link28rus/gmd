import type { NextRequest } from 'next/server';
import {
  getBearer,
  unauthorizedResponse,
  proxyResponse,
  trackViewQuery,
} from '@/app/api/children/_helpers';
import { backend } from '@/lib/backend';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();
  const { id } = await params;
  // v0.80.0: view=road|recorded — трек по дорогам или «как записано».
  const r = await backend(
    'GET',
    `/children/${encodeURIComponent(id)}/trips/active-track${trackViewQuery(req)}`,
    undefined,
    token,
  );
  return proxyResponse(r);
}
