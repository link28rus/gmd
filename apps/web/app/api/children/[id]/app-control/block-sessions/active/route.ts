import type { NextRequest } from 'next/server';
import { proxy } from '../../../../_helpers';

// v0.39 Phase 6.2: текущая активная блокировка для ребёнка.
// Возвращает {sessionId, startedAt, endsAt} | null.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('GET', `/family/children/${id}/app-control/block-sessions/active`, req);
}
