// Dev-прокси подсказок мест (на проде Caddy шлёт /api/zones/* в backend).
import type { NextRequest } from 'next/server';
import { proxy } from '../_helpers';

export async function GET(req: NextRequest) {
  const search = new URL(req.url).search;
  return proxy('GET', `/zones/suggestions${search}`, req);
}
