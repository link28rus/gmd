// Dev-прокси личных настроек уведомлений (на проде Caddy шлёт /api/zones/* в backend).
import type { NextRequest } from 'next/server';
import { proxy } from '../../_helpers';

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  return proxy('PUT', `/zones/${encodeURIComponent(id)}/my-notifications`, req, body);
}
