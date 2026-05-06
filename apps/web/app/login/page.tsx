import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import LoginClient from './login-client';

export default async function LoginPage(): Promise<ReactElement> {
  // Если refresh-cookie уже есть — пользователь залогинен; не показываем форму,
  // а сразу пускаем в кабинет. Симметрично /cabinet → /login при отсутствии cookie.
  const cookieStore = await cookies();
  if (cookieStore.get('gmd_refresh')?.value) {
    redirect('/cabinet');
  }
  return <LoginClient />;
}
