// apps/web/app/cabinet/find-phone/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import FindPhoneClient from './find-phone-client';

export default async function FindPhonePage(): Promise<ReactElement> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) redirect('/login');
  return <FindPhoneClient />;
}
