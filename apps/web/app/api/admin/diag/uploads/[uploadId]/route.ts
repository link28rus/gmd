import type { NextRequest } from 'next/server';
import { proxyAdminGet, proxyAdminWrite } from '../../../_helpers';

type Ctx = { params: Promise<{ uploadId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { uploadId } = await ctx.params;
  return proxyAdminGet(`/admin/diag/uploads/${encodeURIComponent(uploadId)}`, req);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { uploadId } = await ctx.params;
  return proxyAdminWrite('DELETE', `/admin/diag/uploads/${encodeURIComponent(uploadId)}`, req);
}
