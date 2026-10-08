import type { NextRequest } from 'next/server';
import { proxy } from '../../../../zones/_helpers';

// Только для dev: на проде Caddy шлёт /api/parent-location/* прямо в backend.
export async function POST(req: NextRequest, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;
  return proxy('POST', `/parent-location/my-devices/${encodeURIComponent(deviceId)}/signal`, req);
}
