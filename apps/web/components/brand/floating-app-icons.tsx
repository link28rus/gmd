import Image from 'next/image';
import type { ReactElement } from 'react';

/**
 * Две фирменные иконки приложений, вписанные в фон-карту как device-метки
 * геолокации: тайл-аватар + тонкий стебель к «точке на карте» + пульсирующие
 * радар-кольца + подпись «Ребёнок»/«Родитель». Плюс мягкое «парение» и
 * появление при загрузке. Читаются как элементы маршрута, а не наклейки.
 *
 * Чисто декоративно (pointer-events-none, aria-hidden, z-0 — под контентом).
 * Используется на landing (/) и auth-страницах (/login). Радар-кольца и точка
 * — того же sky-blue, что метки карты, поэтому композиция остаётся цельной;
 * тёплое/фиолетовое свечение даёт лёгкий акцент под тайлом.
 */
interface DeviceMarker {
  src: string;
  label: string;
  /** позиционные классы (mobile-first + sm: для desktop) */
  position: string;
  /** мягкое свечение-подложка под тайлом */
  glow: string;
  /** трек «парения» — разные длительности, чтобы не двигались синхронно */
  floatAnim: string;
  /** задержка появления при загрузке */
  appearDelay: string;
}

const MARKERS: DeviceMarker[] = [
  {
    src: '/app-icon-child.png',
    label: 'Ребёнок',
    position: 'left-[5%] top-[6%] sm:left-[7%] sm:top-[34%]',
    glow: 'rgba(251,191,36,0.32)',
    floatAnim: 'marker-float-a 6.5s ease-in-out infinite',
    appearDelay: '0.15s',
  },
  {
    src: '/app-icon-parent.png',
    label: 'Родитель',
    position: 'right-[5%] bottom-[7%] sm:right-[7%] sm:bottom-[32%]',
    glow: 'rgba(139,92,246,0.32)',
    floatAnim: 'marker-float-b 7.8s ease-in-out infinite',
    appearDelay: '0.35s',
  },
];

function DeviceMarkerView({ m }: { m: DeviceMarker }): ReactElement {
  return (
    <div
      className={`marker-anim absolute ${m.position}`}
      style={{ animation: `marker-in 0.7s ease-out ${m.appearDelay} both` }}
    >
      <div className="marker-anim flex flex-col items-center" style={{ animation: m.floatAnim }}>
        {/* Тайл с иконкой + мягкое цветное свечение */}
        <div className="relative">
          <span
            aria-hidden="true"
            className="absolute -inset-3 rounded-full blur-2xl"
            style={{ background: m.glow }}
          />
          <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/15 shadow-[0_16px_44px_-14px_rgba(0,0,0,0.75)]">
            <Image
              src={m.src}
              alt=""
              width={112}
              height={112}
              className="h-11 w-11 sm:h-[3.25rem] sm:w-[3.25rem]"
            />
          </div>
        </div>

        {/* Стебель к точке на карте */}
        <span className="mt-1 h-3 w-px bg-gradient-to-b from-sky-300/50 to-sky-300/0 sm:h-4" />

        {/* Геолокационная точка + пульсирующие радар-кольца */}
        <div className="relative flex h-3 w-3 items-center justify-center">
          <span className="marker-ping absolute h-3 w-3 rounded-full border border-sky-400/70" />
          <span
            className="marker-ping absolute h-3 w-3 rounded-full border border-sky-400/70"
            style={{ animationDelay: '1.5s' }}
          />
          <span className="h-1.5 w-1.5 rounded-full bg-sky-300 shadow-[0_0_8px_2px_rgba(56,189,248,0.7)]" />
        </div>

        {/* Подпись */}
        <span className="mt-1.5 rounded-full border border-slate-600/60 bg-slate-950/70 px-2 py-0.5 text-[10px] font-medium tracking-wide text-slate-200 backdrop-blur-sm sm:text-[11px]">
          {m.label}
        </span>
      </div>
    </div>
  );
}

export function FloatingAppIcons(): ReactElement {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {MARKERS.map((m) => (
        <DeviceMarkerView key={m.label} m={m} />
      ))}
    </div>
  );
}
