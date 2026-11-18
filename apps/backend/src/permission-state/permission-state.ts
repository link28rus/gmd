import { z } from 'zod';

export const PERMISSION_LABELS = {
  accessibility: 'Блокировка приложений',
  deviceAdmin: 'Защита от удаления',
  overlay: 'Поверх других приложений',
  notifications: 'Уведомления',
  locationForeground: 'Геолокация',
  locationBackground: 'Геолокация в фоне',
  batteryUnrestricted: 'Работа без ограничений батареи',
  usageStats: 'Экранное время',
  microphone: 'Микрофон',
  activityRecognition: 'Распознавание движения',
  installPackages: 'Установка обновлений',
} as const;
export type PermissionKey = keyof typeof PERMISSION_LABELS;
const value = z.boolean().nullable();
export const PermissionsSchema = z
  .object({
    accessibility: value,
    deviceAdmin: value,
    overlay: value,
    notifications: value,
    locationForeground: value,
    locationBackground: value,
    batteryUnrestricted: value,
    usageStats: value,
    microphone: value,
    activityRecognition: value,
    installPackages: value,
  })
  .strict();
export type Permissions = z.infer<typeof PermissionsSchema>;
export const PermissionReportSchema = z
  .object({
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    permissions: PermissionsSchema,
  })
  .strict();
export type PermissionReport = z.infer<typeof PermissionReportSchema>;
export const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as PermissionKey[];
export const PERMISSION_STALE_MS = 18 * 60 * 60 * 1000;

export function degradedPermissions(
  before: Permissions | null,
  after: Permissions,
): PermissionKey[] {
  return before ? PERMISSION_KEYS.filter((k) => before[k] === true && after[k] === false) : [];
}

export function permissionView(
  row: { permissions: unknown; reportedAt: Date } | null,
  now = new Date(),
  protectionEnabled = true,
) {
  const permissions = row ? PermissionsSchema.safeParse(row.permissions) : null;
  if (!row || !permissions?.success) {
    return { status: 'unknown' as const, reportedAt: null, permissions: null, missing: [] };
  }
  if (!protectionEnabled) permissions.data.deviceAdmin = null;
  const missing = PERMISSION_KEYS.filter((k) => permissions.data[k] === false).map((key) => ({
    key,
    label: PERMISSION_LABELS[key],
  }));
  const incomplete = PERMISSION_KEYS.some(
    (k) =>
      k !== 'accessibility' &&
      k !== 'usageStats' &&
      (k !== 'deviceAdmin' || protectionEnabled) &&
      permissions.data[k] === null,
  );
  return {
    status:
      now.getTime() - row.reportedAt.getTime() > PERMISSION_STALE_MS
        ? ('stale' as const)
        : missing.length
          ? ('degraded' as const)
          : incomplete
            ? ('unknown' as const)
            : ('ok' as const),
    reportedAt: row.reportedAt,
    permissions: permissions.data,
    missing,
  };
}
