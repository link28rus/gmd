import type { NextRequest } from 'next/server';
import { proxy } from '../../../_helpers';

// v0.38 Phase 6.1: список установленных у ребёнка apps + их usage за сегодня
// + категория + iconUrl. Backend смотрит installed_apps + groupBy usage_buckets.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('GET', `/family/children/${id}/app-control/installed-apps`, req);
}
