'use client';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { Circle, Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { avatarInitial } from '@/lib/color/avatar-color';
import { formatAgeShort } from '@/lib/date/age-format';
import { escapeHtml } from '@/lib/maps/escape-html';
import { isStalePoint } from '@/lib/maps/stale-point';

interface Props {
  lat: number;
  lon: number;
  accuracy: number | null;
  name: string;
  ageSec: number;
  /** Своя метка — подпись «Вы». */
  isMe: boolean;
}

// Родители — тёмно-бирюзовые со скруглённым квадратом, чтобы не путать с
// круглыми аватарами детей (их палитра — lib/color/avatar-color.ts).
const PARENT_COLOR = '#0f766e';
const STALE_COLOR = '#9ca3af';

/**
 * Метка родителя на общей карте семьи: инициал, подпись имени («Вы» для
 * своей), возраст точки сверху, круг точности. Старше 10 минут — серая.
 */
export function ParentMarker({ lat, lon, accuracy, name, ageSec, isMe }: Props): ReactElement {
  const stale = isStalePoint(ageSec);
  const label = isMe ? 'Вы' : name;
  const initial = avatarInitial(name);
  const ageText = formatAgeShort(ageSec);
  const color = stale ? STALE_COLOR : PARENT_COLOR;

  const icon = useMemo(() => {
    const html = `
      <div data-stale="${stale ? '1' : '0'}" style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);position:absolute;left:0;top:0;">
        <div style="margin-bottom:3px;white-space:nowrap;border-radius:9999px;background:${color};padding:1px 8px;font-size:10px;font-weight:500;color:white;box-shadow:0 1px 2px rgba(0,0,0,0.15);">
          ${escapeHtml(ageText)}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;border:3px solid white;color:white;background:${color};box-shadow:0 2px 6px rgba(0,0,0,0.2);font-weight:600;font-size:14px;">
          ${escapeHtml(initial)}
        </div>
        <div style="margin-top:2px;white-space:nowrap;border-radius:6px;background:rgba(255,255,255,0.95);padding:1px 7px;font-size:11px;font-weight:${isMe ? 700 : 500};color:${stale ? '#6b7280' : '#134e4a'};box-shadow:0 1px 3px rgba(0,0,0,0.15);">
          ${escapeHtml(label)}
        </div>
      </div>
    `;
    return L.divIcon({
      html,
      className: 'gmd-parent-marker',
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }, [ageText, color, initial, label, isMe, stale]);

  return (
    <>
      {accuracy !== null && (
        <Circle
          center={[lat, lon]}
          radius={accuracy}
          interactive={false}
          pathOptions={{
            color: stale ? 'rgba(107,114,128,0.5)' : 'rgba(15,118,110,0.5)',
            weight: 1,
            dashArray: '4 4',
            fillColor: stale ? 'rgba(107,114,128,0.10)' : 'rgba(15,118,110,0.10)',
            fillOpacity: 1,
          }}
        />
      )}
      <Marker position={[lat, lon]} icon={icon} zIndexOffset={-100}>
        <Tooltip direction="top" offset={[0, -70]}>
          {isMe ? `Вы (${name})` : name} · {ageText}
          {accuracy !== null ? ` · ±${Math.round(accuracy)} м` : ''}
        </Tooltip>
      </Marker>
    </>
  );
}
