import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { registrationEnabled } from '@/lib/registration';
import RegisterClient from './register-client';

export default async function RegisterPage(): Promise<ReactElement> {
  // Если refresh-cookie уже есть — пользователь залогинен; не показываем форму,
  // а сразу в кабинет. Симметрично /cabinet → /login при отсутствии cookie.
  const cookieStore = await cookies();
  if (cookieStore.get('gmd_refresh')?.value) {
    redirect('/cabinet');
  }
  // Регистрация закрыта (прод семейный) — старые ссылки ведут на вход.
  if (!registrationEnabled()) redirect('/login');
  return <RegisterClient />;
}
