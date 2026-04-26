import type { NextRequest } from 'next/server';
import { proxy } from '../../../_helpers';

// v0.38 Phase 6.1: агрегации usage за выбранный диапазон.
// Query params: ?range=day|week, ?date=YYYY-MM-DD (опционально, default — сегодня
// в TZ ребёнка).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Прокидываем query string как есть в backend.
  const search = new URL(req.url).search;
  return proxy('GET', `/family/children/${id}/app-control/usage${search}`, req);
}
