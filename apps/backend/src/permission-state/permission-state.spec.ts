import { degradedPermissions, PermissionReportSchema, permissionView } from './permission-state';

const good = {
  accessibility: null,
  deviceAdmin: true,
  overlay: true,
  notifications: true,
  locationForeground: true,
  locationBackground: true,
  batteryUnrestricted: true,
  usageStats: null,
  microphone: true,
  activityRecognition: true,
  installPackages: true,
};

describe('Состояние разрешений', () => {
  it('принимает полный слепок и отклоняет неполный/лишние поля/строковый boolean', () => {
    expect(PermissionReportSchema.safeParse({ sequence: 1, permissions: good }).success).toBe(true);
    expect(PermissionReportSchema.safeParse({ sequence: 0, permissions: good }).success).toBe(
      false,
    );
    expect(PermissionReportSchema.safeParse({ sequence: 1, permissions: {} }).success).toBe(false);
    expect(
      PermissionReportSchema.safeParse({ sequence: 1, permissions: { ...good, overlay: 'false' } })
        .success,
    ).toBe(false);
    expect(
      PermissionReportSchema.safeParse({ sequence: 1, permissions: good, childId: 'other' })
        .success,
    ).toBe(false);
  });
  it('первый отчёт и null не считаются деградацией', () => {
    expect(degradedPermissions(null, { ...good, deviceAdmin: false })).toEqual([]);
    expect(degradedPermissions(good, { ...good, deviceAdmin: null })).toEqual([]);
  });
  it('отмечает только true→false; повтор, восстановление и выключенная функция молчат', () => {
    const bad = { ...good, microphone: false, overlay: false };
    expect(degradedPermissions(good, bad)).toEqual(['overlay', 'microphone']);
    expect(degradedPermissions(bad, bad)).toEqual([]);
    expect(degradedPermissions(bad, good)).toEqual([]);
    expect(
      PermissionReportSchema.safeParse({
        sequence: 1,
        permissions: { ...good, accessibility: false },
      }).success,
    ).toBe(false);
    expect(
      PermissionReportSchema.safeParse({ sequence: 1, permissions: { ...good, usageStats: true } })
        .success,
    ).toBe(false);
  });
  it('не выдаёт неизвестное или устаревшее состояние за исправное', () => {
    const now = new Date('2026-11-17T10:00:00Z');
    expect(permissionView(null, now)).toMatchObject({ status: 'unknown' });
    expect(permissionView({ permissions: good, reportedAt: now }, now)).toMatchObject({
      status: 'ok',
      missing: [],
    });
    expect(
      permissionView({ permissions: { ...good, microphone: false }, reportedAt: now }, now),
    ).toMatchObject({ status: 'degraded', missing: [{ key: 'microphone' }] });
    expect(
      permissionView({ permissions: good, reportedAt: new Date('2026-11-16T10:00:00Z') }, now),
    ).toMatchObject({ status: 'stale' });
    expect(
      permissionView({ permissions: { ...good, microphone: null }, reportedAt: now }, now),
    ).toMatchObject({ status: 'unknown' });
    expect(
      permissionView({ permissions: { ...good, deviceAdmin: false }, reportedAt: now }, now, false),
    ).toMatchObject({ status: 'ok', missing: [] });
  });
});
