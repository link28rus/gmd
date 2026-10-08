import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import FamilyClient from './family-client';

export default async function FamilyPage(): Promise<ReactElement> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) redirect('/login');
  return <FamilyClient />;
}
