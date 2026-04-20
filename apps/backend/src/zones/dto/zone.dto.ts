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
  childIds: string[];
  states?: Array<{ childId: string; isInside: boolean }>;
}
