import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import ProfileClient from './profile-client';

export default async function ProfilePage(): Promise<ReactElement> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) redirect('/login');
  return <ProfileClient />;
}
