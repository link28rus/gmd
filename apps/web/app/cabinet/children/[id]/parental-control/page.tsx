import ParentalControlClient from './parental-control-client';

// v0.38 Phase 6.1: «Родительский контроль» — статистика экранного времени.
// Tabs: Сегодня / Вчера / Неделя. Bar chart по часам, чипы категорий, список apps.
//
// Без блокировки — это будет в v0.39 (BlockSession + AppRule).
export default async function ParentalControlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ParentalControlClient childId={id} />;
}
