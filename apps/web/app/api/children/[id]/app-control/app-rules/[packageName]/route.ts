import type { NextRequest } from 'next/server';
import { proxy } from '../../../../_helpers';

// v0.39 Phase 6.2: установить правило для конкретного packageName.
// mode: 'DEFAULT' | 'ALWAYS_ALLOWED' | 'ALWAYS_BLOCKED' (последний пока не из UI).
// Backend перезапишет существующий PARENT-rule или создаст новый.
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; packageName: string }> },
) {
  const { id, packageName } = await ctx.params;
  const body = await req.json();
  // Next.js сам декодирует path-params; backend ждёт raw packageName.
  return proxy(
    'PUT',
    `/family/children/${id}/app-control/app-rules/${encodeURIComponent(packageName)}`,
    req,
    body,
  );
}
