import type { NextRequest } from 'next/server';
import { proxy } from '../../../../children/_helpers';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('POST', `/audio/sessions/${id}/stop`, req);
}
