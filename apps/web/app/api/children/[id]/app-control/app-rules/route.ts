import type { NextRequest } from 'next/server';
import { proxy } from '../../../_helpers';

// v0.39 Phase 6.2: список явно сохранённых правил (PARENT + SYSTEM_DEFAULT).
// HARDCODED отдаются константой на клиенте (HARDCODED_ALLOWED_PACKAGES).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('GET', `/family/children/${id}/app-control/app-rules`, req);
}
