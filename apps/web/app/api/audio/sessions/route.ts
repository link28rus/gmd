import type { NextRequest } from 'next/server';
import { proxy } from '../../children/_helpers';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as unknown;
  return proxy('POST', '/audio/sessions', req, body);
}
