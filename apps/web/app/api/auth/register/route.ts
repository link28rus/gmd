import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

interface RegisterBody {
  lastName?: string;
  firstName?: string;
  middleName?: string;
  familyName?: string;
  email?: string;
  password?: string;
  passwordConfirm?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Partial<RegisterBody>;
  const r = await backend('POST', '/auth/register', {
    lastName: body.lastName,
    firstName: body.firstName,
    middleName: body.middleName,
    familyName: body.familyName,
    email: body.email,
    password: body.password,
    passwordConfirm: body.passwordConfirm,
  });
  return NextResponse.json(r.body ?? {}, { status: r.status });
}
