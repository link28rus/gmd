'use client';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { Circle, Marker } from 'react-leaflet';
import L from 'leaflet';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import { formatAgeShort } from '@/lib/date/age-format';

interface Props {
  lat: number;
  lon: number;
  accuracy: number | null;
  childName: string;
  ageSec: number;
}

/**
 * Маркер последней точки ребёнка для react-leaflet.
 * Используем DivIcon с произвольным HTML — сохраняем визуал как был у Yandex
 * (badge с возрастом + аватар + плашка с именем).
 */
export function LatestMarker({ lat, lon, accuracy, childName, ageSec }: Props): ReactElement {
  const initial = avatarInitial(childName);
  const color = avatarColor(childName);
  const ageText = formatAgeShort(ageSec);

  const icon = useMemo(() => {
    const html = `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);position:absolute;left:0;top:0;">
        <div style="margin-bottom:4px;white-space:nowrap;border-radius:9999px;background:#2563eb;padding:2px 10px;font-size:11px;font-weight:500;color:white;box-shadow:0 1px 2px rgba(0,0,0,0.15);">
          Был тут ${escapeHtml(ageText)}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:3px solid white;color:white;background:${color};box-shadow:0 2px 6px rgba(0,0,0,0.2);font-weight:600;font-size:16px;">
          ${escapeHtml(initial)}
        </div>
        <div style="margin-top:2px;white-space:nowrap;border-radius:6px;background:rgba(255,255,255,0.95);padding:2px 8px;font-size:12px;font-weight:500;color:#111827;box-shadow:0 1px 3px rgba(0,0,0,0.15);">
          ${escapeHtml(childName)}
        </div>
      </div>
    `;
    return L.divIcon({
      html,
      className: 'gmd-latest-marker',
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }, [ageText, color, initial, childName]);

  return (
    <>
      {accuracy !== null && (
        <Circle
          center={[lat, lon]}
          radius={accuracy}
          pathOptions={{
            color: 'rgba(37,99,235,0.5)',
            weight: 1,
            fillColor: 'rgba(37,99,235,0.12)',
            fillOpacity: 1,
          }}
        />
      )}
      <Marker position={[lat, lon]} icon={icon} />
    </>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
