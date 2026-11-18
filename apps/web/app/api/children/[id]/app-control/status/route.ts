import type { NextRequest } from 'next/server';
import { proxy } from '../../../_helpers';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('GET', `/family/children/${id}/app-control/status`, req);
}
