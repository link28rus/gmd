import type { NextRequest } from 'next/server';
import { proxy } from '../../../../_helpers';

// v0.48: PATCH (частичный апдейт, в т.ч. enabled-toggle) + DELETE расписания.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const { id, scheduleId } = await ctx.params;
  const body = await req.json();
  return proxy('PATCH', `/family/children/${id}/app-control/schedules/${scheduleId}`, req, body);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const { id, scheduleId } = await ctx.params;
  return proxy('DELETE', `/family/children/${id}/app-control/schedules/${scheduleId}`, req);
}
