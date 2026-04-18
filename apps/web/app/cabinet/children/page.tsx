// apps/web/app/cabinet/children/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import ChildrenClient from './children-client';

export default async function ChildrenPage(): Promise<ReactElement> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) redirect('/login');
  return <ChildrenClient />;
}
