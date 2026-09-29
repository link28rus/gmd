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
}
