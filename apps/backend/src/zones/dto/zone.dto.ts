export interface ZoneDto {
  id: string;
  familyId: string;
  name: string;
  color: string;
  icon: string;
  centerLat: number;
  centerLon: number;
  radius: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** v0.64.0: зона для всех детей семьи, включая будущих. */
  allChildren: boolean;
  /** Явные назначения (пусто при allChildren). */
  childIds: string[];
  states?: Array<{ childId: string; isInside: boolean }>;
  /** v0.65.0: IANA-пояс зоны для расписания и срока. */
  timezone: string | null;
  schedule: { daysMask: number; startMin: number; endMin: number } | null;
  arrival: { deadlineMin: number; daysMask: number; graceMin: number } | null;
  /** Личные настройки уведомлений текущего пользователя по детям зоны. */
  myPrefs?: ZoneNotificationPrefDto[];
}

export interface ZoneNotificationPrefDto {
  childId: string;
  onEntry: boolean;
  onExit: boolean;
  onMissedArrival: boolean;
}
