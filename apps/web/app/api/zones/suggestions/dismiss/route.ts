// Dev-прокси «больше не показывать» у подсказки места.
import type { NextRequest } from 'next/server';
import { proxy } from '../../_helpers';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return proxy('POST', '/zones/suggestions/dismiss', req, body);
}
