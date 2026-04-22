import type { NextRequest } from 'next/server';
import { proxyAdminWrite } from '../../_helpers';

export async function POST(req: NextRequest) {
  return proxyAdminWrite('POST', '/admin/smtp/test', req);
}
