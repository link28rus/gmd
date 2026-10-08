'use client';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { Circle, Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { formatAgeShort } from '@/lib/date/age-format';
import { escapeHtml } from '@/lib/maps/escape-html';
import { isStalePoint } from '@/lib/maps/stale-point';

interface Props {
  lat: number;
  lon: number;
  accuracy: number | null;
  name: string;
  ageSec: number;
  /** Телефон звонит прямо сейчас — красная плашка «Звонит» вместо возраста. */
  ringing: boolean;
}

// Свой телефон — тёмно-бирюзовый, как метка родителя на общей карте
// (components/locations/parent-marker.tsx), но с иконкой телефона.
const PHONE_COLOR = '#0f766e';
const STALE_COLOR = '#9ca3af';
const RINGING_COLOR = '#dc2626';

// lucide «smartphone» — инлайном: DivIcon принимает только HTML-строку.
const PHONE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>';

/**
 * Метка своего телефона на странице «Найти телефон»: возраст точки сверху,
 * иконка телефона, подпись имени, круг точности. Старше 10 минут — серая.
 */
export function PhoneMarker({ lat, lon, accuracy, name, ageSec, ringing }: Props): ReactElement {
  const stale = isStalePoint(ageSec);
  const ageText = formatAgeShort(ageSec);
  const color = stale ? STALE_COLOR : PHONE_COLOR;
  const badgeColor = ringing ? RINGING_COLOR : color;
  const badgeText = ringing ? 'Звонит' : `Был тут ${ageText}`;

  const icon = useMemo(() => {
    const html = `
      <div data-stale="${stale ? '1' : '0'}" style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);position:absolute;left:0;top:0;">
        <div style="margin-bottom:4px;white-space:nowrap;border-radius:9999px;background:${badgeColor};padding:2px 10px;font-size:11px;font-weight:500;color:white;box-shadow:0 1px 2px rgba(0,0,0,0.15);">
          ${escapeHtml(badgeText)}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;border:3px solid white;color:white;background:${color};box-shadow:0 2px 6px rgba(0,0,0,0.2);">
          ${PHONE_SVG}
        </div>
        <div style="margin-top:2px;white-space:nowrap;border-radius:6px;background:rgba(255,255,255,0.95);padding:2px 8px;font-size:12px;font-weight:500;color:${stale ? '#6b7280' : '#134e4a'};box-shadow:0 1px 3px rgba(0,0,0,0.15);">
          ${escapeHtml(name)}
        </div>
      </div>
    `;
    return L.divIcon({
      html,
      className: 'gmd-phone-marker',
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }, [badgeColor, badgeText, color, name, stale]);

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
      <Marker position={[lat, lon]} icon={icon} zIndexOffset={500}>
        <Tooltip direction="top" offset={[0, -70]}>
          {name} · {ageText}
          {accuracy !== null ? ` · ±${Math.round(accuracy)} м` : ''}
        </Tooltip>
      </Marker>
    </>
  );
}
