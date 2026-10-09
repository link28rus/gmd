'use client';
import type { ReactElement } from 'react';
import { useTrackView } from '@/lib/hooks/use-track-view';

/**
 * v0.80.0: кнопка на карте «Как записано» — показать трек без привязки к
 * дорогам. По умолчанию выключена (трек по дорогам). Выбор общий для всех
 * карт кабинета (lib/hooks/use-track-view.ts). Стоит в правой колонке
 * кнопок под зумом, как «Показать геозоны»; marginTop — её место в колонке.
 *
 * hasTrack=false — трека нет, кнопку прячем; но если уже включено «как
 * записано», оставляем, чтобы можно было вернуться.
 */
export function TrackViewToggleControl({
  marginTop,
  hasTrack,
}: {
  marginTop: number;
  hasTrack: boolean;
}): ReactElement | null {
  const [view, setView] = useTrackView();
  const recorded = view === 'recorded';
  if (!hasTrack && !recorded) return null;
  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: 'auto' }}>
      <div className="leaflet-control leaflet-bar" style={{ marginTop, marginRight: 10 }}>
        <a
          href="#"
          role="button"
          aria-pressed={recorded}
          title="Показать трек без привязки к дорогам"
          onClick={(e) => {
            e.preventDefault();
            setView(recorded ? 'road' : 'recorded');
          }}
          className={`!flex h-[30px] !w-auto items-center gap-1.5 whitespace-nowrap px-2 text-xs font-medium !leading-none ${
            recorded ? '!bg-primary !text-primary-foreground' : 'bg-card text-foreground'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="5" cy="18" r="2" />
            <circle cx="19" cy="6" r="2" />
            <path d="M7 17 12 13 10 10 17 7" />
          </svg>
          Как записано
        </a>
      </div>
    </div>
  );
}
