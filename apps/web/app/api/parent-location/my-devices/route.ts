import type { NextRequest } from 'next/server';
import { proxy } from '../../zones/_helpers';

// Только для dev: на проде Caddy шлёт /api/parent-location/* прямо в backend.
// v0.73.0 «Найти телефон»: свои телефоны текущего пользователя.
export async function GET(req: NextRequest) {
  return proxy('GET', '/parent-location/my-devices', req);
}
