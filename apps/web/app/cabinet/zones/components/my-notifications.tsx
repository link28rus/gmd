// apps/web/app/cabinet/zones/components/my-notifications.tsx
// «Мои уведомления» по зоне: личные настройки текущего родителя (спека 2.1, 2.5).
'use client';

import type { ReactElement } from 'react';
import { toast } from 'sonner';
import { zoneErrorMessage, type Zone, type ZoneChildPrefs } from '@/lib/api/zones';
import { useSetMyNotifications } from '@/lib/hooks/use-zones';
import { ToggleSwitch } from './toggle-switch';

type PrefField = 'onEntry' | 'onExit' | 'onMissedArrival';

const FIELDS: Array<{ field: PrefField; label: string }> = [
  { field: 'onEntry', label: 'Приход' },
  { field: 'onExit', label: 'Уход' },
  { field: 'onMissedArrival', label: 'Не пришёл к сроку' },
];

interface Props {
  zone: Zone;
  kidNames: Map<string, string>;
}

export function MyNotifications({ zone, kidNames }: Props): ReactElement {
  const setPrefs = useSetMyNotifications();
  const prefs = (zone.myPrefs ?? []).filter((p) => kidNames.has(p.childId));
  const hasArrival = !!zone.arrival;

  const toggle = (childId: string, field: PrefField, value: boolean): void => {
    const items: ZoneChildPrefs[] = (zone.myPrefs ?? []).map((p) =>
      p.childId === childId ? { ...p, [field]: value } : p,
    );
    setPrefs.mutate(
      { zoneId: zone.id, items },
      { onError: (e) => toast.error(zoneErrorMessage(e, 'prefs')) },
    );
  };

  return (
    <section aria-label="Мои уведомления" className="space-y-2">
      <div>
        <h3 className="text-xs font-semibold text-foreground">Мои уведомления</h3>
        <p className="text-xs text-muted-foreground">
          Только для вас — у другого родителя свои настройки.
        </p>
      </div>
      {prefs.length === 0 ? (
        <p className="text-xs text-muted-foreground">В зоне пока нет детей.</p>
      ) : (
        <ul className="space-y-2">
          {prefs.map((p) => {
            const name = kidNames.get(p.childId) ?? '';
            return (
              <li key={p.childId}>
                <p className="text-xs font-medium text-foreground">{name}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
                  {FIELDS.map(({ field, label }) => {
                    const disabled = field === 'onMissedArrival' && !hasArrival;
                    return (
                      <label
                        key={field}
                        className={[
                          'inline-flex select-none items-center gap-1.5 text-xs',
                          disabled ? 'text-muted-foreground' : 'cursor-pointer text-foreground',
                        ].join(' ')}
                        title={
                          disabled
                            ? 'У зоны не задан срок — включите его в настройках зоны'
                            : undefined
                        }
                      >
                        <ToggleSwitch
                          checked={!disabled && p[field]}
                          onChange={(v) => toggle(p.childId, field, v)}
                          ariaLabel={`${name}: ${label.toLowerCase()}`}
                          disabled={disabled}
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
