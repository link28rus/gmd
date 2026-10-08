import type { NextRequest } from 'next/server';
import { proxy } from '../../../../zones/_helpers';

// Только для dev: на проде Caddy шлёт /api/parent-location/* прямо в backend.
// Query (from/to) пробрасываем как есть — валидирует backend (≤ 2 суток).
export async function GET(req: NextRequest, ctx: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await ctx.params;
  return proxy(
    'GET',
    `/parent-location/my-devices/${encodeURIComponent(deviceId)}/track${req.nextUrl.search}`,
    req,
  );
}
