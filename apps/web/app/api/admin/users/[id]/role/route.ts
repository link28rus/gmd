import type { NextRequest } from 'next/server';
import { proxyAdminWrite } from '../../../_helpers';

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return proxyAdminWrite('PATCH', `/admin/users/${id}/role`, req);
}
