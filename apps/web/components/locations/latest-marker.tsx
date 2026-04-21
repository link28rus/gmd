'use client';
import type { ReactElement } from 'react';
import { YMapMarker, YMapFeature } from 'ymap3-components';
import { circlePolygon } from '@/lib/geo/circle-polygon';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import { formatAgeShort } from '@/lib/date/age-format';

interface Props {
  lat: number;
  lon: number;
  accuracy: number | null;
  childName: string;
  ageSec: number;
}

export function LatestMarker({ lat, lon, accuracy, childName, ageSec }: Props): ReactElement {
  const initial = avatarInitial(childName);
  const color = avatarColor(childName);
  const ageText = formatAgeShort(ageSec);
  return (
    <>
      {accuracy !== null && (
        <YMapFeature
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          geometry={
            {
              type: 'Polygon',
              coordinates: [circlePolygon(lat, lon, accuracy)],
            } as any
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          style={
            {
              stroke: [{ color: 'rgba(37,99,235,0.5)', width: 1 }],
              fill: 'rgba(37,99,235,0.12)',
            } as any
          }
        />
      )}
      <YMapMarker coordinates={[lon, lat]}>
        <div className="-translate-x-1/2 -translate-y-full flex flex-col items-center">
          {/* «Был тут N мин назад» — tooltip над маркером */}
          <div className="mb-1 whitespace-nowrap rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-medium text-white shadow">
            Был тут {ageText}
          </div>
          {/* Аватар с инициалом */}
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white text-white shadow-md"
            style={{ backgroundColor: color }}
            title={childName}
          >
            <span className="text-base font-semibold">{initial}</span>
          </div>
          {/* Плашка с именем под аватаром */}
          <div className="mt-0.5 whitespace-nowrap rounded-md bg-white/95 px-2 py-0.5 text-xs font-medium text-zinc-800 shadow">
            {childName}
          </div>
        </div>
      </YMapMarker>
    </>
  );
}
