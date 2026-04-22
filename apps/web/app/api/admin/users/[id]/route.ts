import type { NextRequest } from 'next/server';
import { proxyAdminGet, proxyAdminWrite } from '../../_helpers';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyAdminGet(`/admin/users/${id}`, req);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyAdminWrite('DELETE', `/admin/users/${id}`, req);
}
