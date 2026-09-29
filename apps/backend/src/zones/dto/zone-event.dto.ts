export interface ZoneEventDto {
  id: string;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  zoneIcon: string;
  childId: string;
  childName: string;
  type: 'entry' | 'exit';
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
  createdAt: string;
  /** v0.64.0: у выхода — сколько пробыл в зоне, секунды; иначе null. */
  durationSec: number | null;
}
