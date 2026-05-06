import type { NextRequest } from 'next/server';
import { proxy } from '../../../_helpers';

// v0.48 Phase 6.x: список расписаний автоблокировки приложений + создание.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('GET', `/family/children/${id}/app-control/schedules`, req);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  return proxy('POST', `/family/children/${id}/app-control/schedules`, req, body);
}
