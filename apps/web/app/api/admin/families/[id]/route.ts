import type { NextRequest } from 'next/server';
import { proxyAdminWrite } from '../../_helpers';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyAdminWrite('DELETE', `/admin/families/${id}`, req);
}
