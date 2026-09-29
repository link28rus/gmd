import type { NextRequest } from 'next/server';
import { proxy } from '../../../zones/_helpers';

// Только для dev: на проде Caddy шлёт /api/family/* прямо в backend.
export async function GET(req: NextRequest) {
  return proxy('GET', '/family/locations/latest', req);
}
