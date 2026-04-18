import type { NextRequest } from 'next/server';
import { proxy } from './_helpers';

export async function GET(req: NextRequest) {
  return proxy('GET', '/family/children', req);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return proxy('POST', '/family/children', req, body);
}
