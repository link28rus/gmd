import type { NextRequest } from 'next/server';
import { proxy } from '../_helpers';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('GET', `/zones/${id}`, req);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  return proxy('PATCH', `/zones/${id}`, req, body);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('DELETE', `/zones/${id}`, req);
}
