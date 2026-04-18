import type { NextRequest } from 'next/server';
import { proxyAdminGet } from '../_helpers';

export async function GET(req: NextRequest) {
  return proxyAdminGet('/admin/users', req);
}
