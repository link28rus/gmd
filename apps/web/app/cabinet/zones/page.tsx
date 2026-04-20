// apps/web/app/cabinet/zones/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import ZonesClient from './zones-client';

export default async function ZonesPage(): Promise<ReactElement> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) redirect('/login');
  return <ZonesClient />;
}
