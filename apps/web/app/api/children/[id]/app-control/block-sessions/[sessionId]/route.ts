import type { NextRequest } from 'next/server';
import { proxy } from '../../../../_helpers';

// v0.39 Phase 6.2: завершить активную сессию (родитель «Снять блок»).
// 204. Идемпотентно для уже ENDED/EXPIRED сессий.
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id, sessionId } = await ctx.params;
  return proxy('DELETE', `/family/children/${id}/app-control/block-sessions/${sessionId}`, req);
}
