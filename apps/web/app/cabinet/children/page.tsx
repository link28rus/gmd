// apps/web/app/cabinet/children/page.tsx
// Deprecated: страница «Мои дети» схлопнулась в главную `/cabinet`
// (список детей слева + карта справа).
import { redirect } from 'next/navigation';

export default function ChildrenPage(): never {
  redirect('/cabinet');
}
