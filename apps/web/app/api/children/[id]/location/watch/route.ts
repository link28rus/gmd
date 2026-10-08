import type { NextRequest } from 'next/server';
import { proxy } from '@/app/api/children/_helpers';

// v0.69.0: «родитель смотрит карту ребёнка» на 90 с — пока отметка жива,
// backend шлёт тихий push LOCATION_UPDATED о новых точках (mobile-parent).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxy('PUT', `/children/${encodeURIComponent(id)}/location/watch`, req);
}
