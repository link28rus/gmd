import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import JoinClient from './join-client';

export const metadata: Metadata = {
  title: 'Приглашение в семью — Перископ',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ code: string }>;
}

/**
 * Публичная страница приглашения взрослого в семью (v0.71.0). Без refresh-cookie
 * сразу показываем «Войдите или зарегистрируйтесь», с cookie — превью и «Присоединиться».
 */
export default async function JoinPage({ params }: Props): Promise<ReactElement> {
  const { code } = await params;
  const cookieStore = await cookies();
  const hasSession = Boolean(cookieStore.get('gmd_refresh')?.value);
  return <JoinClient rawCode={safeDecode(code)} hasSession={hasSession} />;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
