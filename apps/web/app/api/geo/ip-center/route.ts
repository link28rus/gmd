import type { NextRequest } from 'next/server';
import { proxy } from '../../zones/_helpers';

// Только для dev: на проде Caddy шлёт /api/geo/* прямо в backend, и backend
// видит реальный IP клиента. Через этот прокси backend видит адрес web-сервера
// (локальный) и отвечает 204 — кабинет тогда падает на запасной центр карты.
export async function GET(req: NextRequest) {
  return proxy('GET', '/geo/ip-center', req);
}
