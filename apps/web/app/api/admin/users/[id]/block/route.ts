import type { NextRequest } from 'next/server';
import { proxyAdminWrite } from '../../../_helpers';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return proxyAdminWrite('POST', `/admin/users/${id}/block`, req);
}
