'use client';
import type { ReactElement, ReactNode } from 'react';
import { useMemo } from 'react';
import { Circle, Marker } from 'react-leaflet';
import L from 'leaflet';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import { formatAgeShort } from '@/lib/date/age-format';
import { escapeHtml } from '@/lib/maps/escape-html';
import { isStalePoint } from '@/lib/maps/stale-point';

interface Props {
  lat: number;
  lon: number;
  accuracy: number | null;
  childName: string;
  ageSec: number;
  /** Готовый src аватара (пресет или blob: URL фото); без него — буква имени. */
  avatarUrl?: string | null;
  /** Клик по маркеру (например, переход к ребёнку с общей карты). */
  onClick?: () => void;
  /** Содержимое маркера (например, `<Popup>` с действиями). */
  children?: ReactNode;
}

const FRESH_BADGE = '#2563eb';
const STALE_BADGE = '#6b7280';

/**
 * Маркер последней точки ребёнка для react-leaflet.
 * Используем DivIcon с произвольным HTML — сохраняем визуал как был у Yandex
 * (badge с возрастом + аватар + плашка с именем).
 * Точка старше 10 минут (`STALE_POINT_SEC`) — метка серая.
 */
export function LatestMarker({
  lat,
  lon,
  accuracy,
  childName,
  ageSec,
  avatarUrl,
  onClick,
  children,
}: Props): ReactElement {
  const initial = avatarInitial(childName);
  const stale = isStalePoint(ageSec);
  const color = stale ? '#9ca3af' : avatarColor(childName);
  const ageText = formatAgeShort(ageSec);

  const icon = useMemo(() => {
    const imgFilter = stale ? 'filter:grayscale(1);opacity:0.7;' : '';
    const avatar = avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;${imgFilter}" />`
      : escapeHtml(initial);
    const html = `
      <div data-stale="${stale ? '1' : '0'}" style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);position:absolute;left:0;top:0;">
        <div style="margin-bottom:4px;white-space:nowrap;border-radius:9999px;background:${stale ? STALE_BADGE : FRESH_BADGE};padding:2px 10px;font-size:11px;font-weight:500;color:white;box-shadow:0 1px 2px rgba(0,0,0,0.15);">
          Был тут ${escapeHtml(ageText)}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:3px solid white;color:white;background:${color};box-shadow:0 2px 6px rgba(0,0,0,0.2);font-weight:600;font-size:16px;overflow:hidden;">
          ${avatar}
        </div>
        <div style="margin-top:2px;white-space:nowrap;border-radius:6px;background:rgba(255,255,255,0.95);padding:2px 8px;font-size:12px;font-weight:500;color:${stale ? '#6b7280' : '#111827'};box-shadow:0 1px 3px rgba(0,0,0,0.15);">
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
  }, [ageText, color, initial, childName, avatarUrl, stale]);

  const eventHandlers = useMemo(() => (onClick ? { click: onClick } : undefined), [onClick]);

  return (
    <>
      {accuracy !== null && (
        <Circle
          center={[lat, lon]}
          radius={accuracy}
          interactive={false}
          pathOptions={
            stale
              ? {
                  color: 'rgba(107,114,128,0.5)',
                  weight: 1,
                  fillColor: 'rgba(107,114,128,0.12)',
                  fillOpacity: 1,
                }
              : {
                  color: 'rgba(37,99,235,0.5)',
                  weight: 1,
                  fillColor: 'rgba(37,99,235,0.12)',
                  fillOpacity: 1,
                }
          }
        />
      )}
      <Marker position={[lat, lon]} icon={icon} eventHandlers={eventHandlers}>
        {children}
      </Marker>
    </>
  );
}
