import type { NextRequest } from 'next/server';
import { proxyAdminWrite } from '../../../_helpers';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyAdminWrite('POST', `/admin/children/${id}/reset-device`, req);
}
