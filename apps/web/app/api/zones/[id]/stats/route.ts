// Dev-прокси статистики визитов в зону.
import type { NextRequest } from 'next/server';
import { proxy } from '../../_helpers';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const search = new URL(req.url).search;
  return proxy('GET', `/zones/${encodeURIComponent(id)}/stats${search}`, req);
}
