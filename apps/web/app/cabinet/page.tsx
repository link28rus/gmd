import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import CabinetClient from './cabinet-client';

export default async function CabinetPage(): Promise<ReactElement> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) {
    redirect('/login');
  }
  return <CabinetClient />;
}
