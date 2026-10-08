import type { NextRequest } from 'next/server';
import { proxy } from '../../../zones/_helpers';

// Только для dev: на проде Caddy шлёт /api/parent-location/* прямо в backend.
// v0.74.0: своё имя телефона.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;
  const body = await req.json();
  return proxy('PATCH', `/parent-location/my-devices/${encodeURIComponent(deviceId)}`, req, body);
}
