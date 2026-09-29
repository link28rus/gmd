export interface ZoneEventDto {
  id: string;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  zoneIcon: string;
  childId: string;
  childName: string;
  /** v0.65.0: + missed_arrival (не пришёл к сроку), no_data (телефон молчал к сроку). */
  type: 'entry' | 'exit' | 'missed_arrival' | 'no_data';
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
  createdAt: string;
  /** v0.64.0: у выхода — сколько пробыл в зоне, секунды; иначе null. */
  durationSec: number | null;
}
