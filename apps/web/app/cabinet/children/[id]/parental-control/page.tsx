import { APP_CONTROL_ENABLED } from '@/lib/features';
import AppControlDisabled from './app-control-disabled';
import ParentalControlClient from './parental-control-client';

// v0.38 Phase 6.1: «Родительский контроль» — статистика экранного времени.
// Tabs: Сегодня / Вчера / Неделя. Bar chart по часам, чипы категорий, список apps.
//
// Без блокировки — это будет в v0.39 (BlockSession + AppRule).
export default async function ParentalControlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v0.58.0: функция временно отключена — см. lib/features.ts.
  if (!APP_CONTROL_ENABLED) return <AppControlDisabled />;
  return <ParentalControlClient childId={id} />;
}
