// Цвет аватара-маркера ребёнка. Детерминированный hash от имени, чтобы у
// одного ребёнка он не мигал между сессиями, но у разных детей цвета
// разные — так родитель мгновенно отличает их на общей карте.
const PALETTE = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#ea580c', // orange
  '#9333ea', // purple
  '#0891b2', // cyan
  '#c026d3', // fuchsia
  '#65a30d', // lime
] as const;

export function avatarColor(name: string): string {
  const s = name.trim();
  if (s.length === 0) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) & 0xffffffff;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
