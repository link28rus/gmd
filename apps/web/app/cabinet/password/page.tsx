import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import PasswordClient from './password-client';

export default async function PasswordPage(): Promise<ReactElement> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) redirect('/login');
  return <PasswordClient />;
}
