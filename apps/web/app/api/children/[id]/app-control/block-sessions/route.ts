import type { NextRequest } from 'next/server';
import { proxy } from '../../../_helpers';

// v0.39 Phase 6.2: создать BlockSession для ребёнка.
// Backend проверяет 5..1440 min и 409 если уже есть ACTIVE сессия.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  return proxy('POST', `/family/children/${id}/app-control/block-sessions`, req, body);
}
