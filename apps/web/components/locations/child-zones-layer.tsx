'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { Circle, Tooltip } from 'react-leaflet';
import type { Zone } from '@/lib/api/zones';

const STORAGE_KEY = 'gmd:child-map-zones';

/** Зоны, которые касаются ребёнка: «для всех детей» или назначенные ему. */
export function zonesForChild(zones: Zone[], childId: string): Zone[] {
  return zones.filter((z) => z.allChildren || z.childIds.includes(childId));
}

/**
 * v0.70.1: показ геозон на карте ребёнка — по умолчанию включён, выбор
 * родителя помним в localStorage (один на все карты детей).
 */
export function useShowChildZones(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '0') setShow(false);
    } catch {
      // localStorage недоступен — остаёмся на умолчании
    }
  }, []);
  const update = (v: boolean): void => {
    setShow(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    } catch {
      // не критично
    }
  };
  return [show, update];
}

/** Круги геозон под метками и треком; клики проходят насквозь, имя — в подсказке. */
export function ChildZonesLayer({ zones }: { zones: Zone[] }): ReactElement {
  return (
    <>
      {zones.map((zone) => (
        <Circle
          key={zone.id}
          center={[zone.centerLat, zone.centerLon]}
          radius={zone.radius}
          pathOptions={{
            color: zone.color,
            weight: 2,
            fillColor: zone.color,
            fillOpacity: 0.15,
          }}
        >
          <Tooltip direction="top" sticky>
            {zone.name}
          </Tooltip>
        </Circle>
      ))}
    </>
  );
}

/** Кнопка на карте «Показать / скрыть геозоны» (под «К ребёнку»). */
export function ZonesToggleControl({
  show,
  onToggle,
  marginTop,
}: {
  show: boolean;
  onToggle: () => void;
  marginTop: number;
}): ReactElement {
  const label = show ? 'Скрыть геозоны' : 'Показать геозоны';
  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: 'auto' }}>
      <div className="leaflet-control leaflet-bar" style={{ marginTop, marginRight: 10 }}>
        <a
          href="#"
          role="button"
          aria-label={label}
          aria-pressed={show}
          title={label}
          onClick={(e) => {
            e.preventDefault();
            onToggle();
          }}
          className={`!flex h-[30px] w-[30px] items-center justify-center ${
            show ? '!bg-primary !text-primary-foreground' : 'bg-card text-foreground'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
            <circle cx="12" cy="12" r="2" />
          </svg>
        </a>
      </div>
    </div>
  );
}
