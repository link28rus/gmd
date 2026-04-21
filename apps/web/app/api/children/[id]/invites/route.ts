import type { NextRequest } from 'next/server';
import { proxy } from '../../_helpers';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Читаем body один раз — в нём может быть { consent14PlusGranted: boolean }.
  // Если тела нет — proxy() передаст undefined, backend примет как empty object.
  let body: unknown = undefined;
  try {
    body = await req.json();
  } catch {
    // no body — ок
  }
  return proxy('POST', `/family/children/${id}/invites`, req, body);
}
