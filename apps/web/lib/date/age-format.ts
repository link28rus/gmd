// Короткий формат возраста данных для плашки над маркером
// (инспирирован gdemoideti.ru: «Был тут 3 мин. назад»).
export function formatAgeShort(ageSec: number): string {
  const s = Math.max(0, Math.round(ageSec));
  if (s < 45) return 'только что';
  if (s < 90) return '1 мин назад';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  const hours = Math.round(s / 3600);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(s / 86400);
  return `${days} дн назад`;
}
