'use client';

import { useId, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ColorPicker } from './color-picker';
import { IconPicker } from './icon-picker';
import { AddressSearch } from './address-search';
import { ZoneEditorMap } from './zone-editor-map';
import { useCreateZone, useUpdateZone } from '@/lib/hooks/use-zones';
import {
  ZONE_RADIUS_DEFAULT,
  ZONE_RADIUS_MAX,
  ZONE_RADIUS_MIN,
  zoneErrorMessage,
  type Zone,
  type ZoneColor,
  type ZoneIcon,
} from '@/lib/api/zones';
import type { GeocodeHit } from '@/lib/api/geocode';
import { browserTimeZone } from './zone-format';
import {
  ArrivalFields,
  ScheduleFields,
  TimeZoneNote,
  arrivalError,
  arrivalPayload,
  initialArrivalDraft,
  initialScheduleDraft,
  scheduleError,
  schedulePayload,
} from './zone-rules-fields';
import { toast } from 'sonner';

/** v0.67.0: заготовка новой зоны из подсказки места. */
export interface ZonePrefill {
  name: string;
  icon: ZoneIcon;
  color: ZoneColor;
  radius: number;
  childIds: string[];
}

export interface KidOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Дети семьи для назначения зоны */
  kids: KidOption[];
  initial?: Zone;
  /**
   * Центр новой зоны: точка двойного клика, точка ребёнка или текущий центр
   * карты («+ Новая»). Без него — Москва (крайний случай).
   */
  initialCenter?: { lat: number; lon: number };
  /** Стартовый масштаб карты редактора для новой зоны. */
  initialZoom?: number;
  /** Зона создаётся «от ребёнка» — его отмечаем, если снять «Все дети». */
  initialChildId?: string;
  /** Имя, иконка, цвет, радиус и дети из подсказки места. */
  prefill?: ZonePrefill;
  onSaved: (z: Zone) => void;
}

const DEFAULT_LAT = 55.7558;
const DEFAULT_LON = 37.6173;
const DEFAULT_COLOR: ZoneColor = '#22c55e';
const DEFAULT_ICON: ZoneIcon = 'home';

function clampRadius(m: number): number {
  return Math.max(ZONE_RADIUS_MIN, Math.min(ZONE_RADIUS_MAX, Math.round(m)));
}

export function ZoneEditorDialog({
  open,
  onOpenChange,
  kids,
  initial,
  initialCenter,
  initialZoom,
  initialChildId,
  prefill,
  onSaved,
}: Props) {
  // key пересоздаёт форму при смене режима/зоны/центра — чинит «второе открытие»
  const formKey =
    initial?.id ??
    `new:${initialCenter?.lat ?? '_'}:${initialCenter?.lon ?? '_'}:${initialChildId ?? '_'}:${prefill ? `${prefill.icon}:${prefill.radius}` : '_'}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{initial ? 'Изменить зону' : 'Новая зона'}</DialogTitle>
        </DialogHeader>

        <ZoneEditorForm
          key={formKey}
          kids={kids}
          initial={initial}
          initialCenter={initialCenter}
          initialZoom={initialZoom}
          initialChildId={initialChildId}
          prefill={prefill}
          onCancel={() => onOpenChange(false)}
          onSaved={(z) => {
            onSaved(z);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  kids: KidOption[];
  initial?: Zone;
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
  initialChildId?: string;
  prefill?: ZonePrefill;
  onCancel: () => void;
  onSaved: (z: Zone) => void;
}

function ZoneEditorForm({
  kids,
  initial,
  initialCenter,
  initialZoom,
  initialChildId,
  prefill,
  onCancel,
  onSaved,
}: FormProps) {
  const [address, setAddress] = useState('');
  const [name, setName] = useState(initial?.name ?? prefill?.name ?? '');
  const [color, setColor] = useState<ZoneColor>(initial?.color ?? prefill?.color ?? DEFAULT_COLOR);
  const [icon, setIcon] = useState<ZoneIcon>(initial?.icon ?? prefill?.icon ?? DEFAULT_ICON);
  const [centerLat, setCenterLat] = useState(
    initial?.centerLat ?? initialCenter?.lat ?? DEFAULT_LAT,
  );
  const [centerLon, setCenterLon] = useState(
    initial?.centerLon ?? initialCenter?.lon ?? DEFAULT_LON,
  );
  // Старые зоны могли быть меньше 100 м (раньше UI разрешал 50) — подтягиваем в допустимое.
  const [radius, setRadius] = useState(() =>
    clampRadius(initial?.radius ?? prefill?.radius ?? ZONE_RADIUS_DEFAULT),
  );
  // Новая зона — по умолчанию для всех детей, включая будущих. Подсказка места
  // одного из детей — только для него (место общее на всех — снова «все»).
  const [allChildren, setAllChildren] = useState(
    initial?.allChildren ?? (prefill ? kids.every((k) => prefill.childIds.includes(k.id)) : true),
  );
  const [childIds, setChildIds] = useState<string[]>(() => {
    if (initial) return initial.childIds ?? [];
    if (prefill) return prefill.childIds;
    if (initialChildId) return [initialChildId];
    return kids.map((c) => c.id);
  });
  const [recenterSeq, setRecenterSeq] = useState(0);
  const [schedule, setSchedule] = useState(() => initialScheduleDraft(initial));
  const [arrival, setArrival] = useState(() => initialArrivalDraft(initial));
  // Пояс берётся из браузера молча и уходит при каждом сохранении (спека 2.1).
  const [browserTz] = useState(browserTimeZone);
  const allChildrenId = useId();

  const create = useCreateZone();
  const update = useUpdateZone();
  const saving = create.isPending || update.isPending;
  const noChildrenSelected = !allChildren && childIds.length === 0;
  const rulesOn = schedule.on || arrival.on;
  const rulesInvalid =
    scheduleError(schedule) !== null ||
    arrivalError(arrival) !== null ||
    (rulesOn && browserTz === null);

  const handleAddressPick = (hit: GeocodeHit) => {
    setCenterLat(hit.lat);
    setCenterLon(hit.lon);
    setRecenterSeq((n) => n + 1);
    if (!name.trim()) setName(hit.name.split(',')[0].trim().slice(0, 60));
  };

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error('Укажите имя зоны');
      return;
    }
    if (noChildrenSelected) {
      toast.error('Выберите хотя бы одного ребёнка или включите «Все дети»');
      return;
    }
    const rulesProblem =
      scheduleError(schedule) ??
      arrivalError(arrival) ??
      (rulesOn && browserTz === null ? 'Не удалось определить часовой пояс браузера.' : null);
    if (rulesProblem) {
      toast.error(rulesProblem);
      return;
    }
    const payload = {
      name: name.trim(),
      color,
      icon,
      centerLat,
      centerLon,
      radius,
      allChildren,
      childIds: allChildren ? [] : childIds,
      ...(browserTz ? { timezone: browserTz } : {}),
      schedule: schedulePayload(schedule),
      arrival: arrivalPayload(arrival),
    };
    try {
      const saved = initial
        ? await update.mutateAsync({ id: initial.id, patch: payload })
        : await create.mutateAsync(payload);
      toast.success(initial ? 'Зона обновлена' : 'Зона создана');
      onSaved(saved);
    } catch (e) {
      toast.error(zoneErrorMessage(e, 'save'));
    }
  };

  return (
    <>
      <div className="space-y-4">
        <AddressSearch
          value={address}
          onChange={setAddress}
          onPick={handleAddressPick}
          near={{ lat: centerLat, lon: centerLon }}
        />

        <ZoneEditorMap
          centerLat={centerLat}
          centerLon={centerLon}
          radius={radius}
          color={color}
          recenterSeq={recenterSeq}
          initialZoom={initialZoom}
          onCenterChange={(lat, lon) => {
            setCenterLat(lat);
            setCenterLon(lon);
          }}
          onRadiusChange={setRadius}
        />

        <p className="text-xs text-muted-foreground">
          Кликните по карте, чтобы переместить центр зоны. Перетащите точку на краю круга, чтобы
          изменить радиус.
        </p>

        <div>
          <Label htmlFor="zone-radius">Радиус: {radius} м</Label>
          <input
            id="zone-radius"
            type="range"
            min={ZONE_RADIUS_MIN}
            max={ZONE_RADIUS_MAX}
            step={10}
            value={radius}
            onChange={(e) => setRadius(clampRadius(Number(e.target.value)))}
            className="mt-1 w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{ZONE_RADIUS_MIN} м</span>
            <span>{ZONE_RADIUS_MAX / 1000} км</span>
          </div>
        </div>

        <div>
          <Label htmlFor="zone-name">Название</Label>
          <Input
            id="zone-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Например: Школа"
          />
        </div>

        <div>
          <Label>Цвет</Label>
          <div className="mt-1">
            <ColorPicker value={color} onChange={(c) => setColor(c as ZoneColor)} />
          </div>
        </div>

        <div>
          <Label>Иконка</Label>
          <div className="mt-1">
            <IconPicker value={icon} onChange={(i) => setIcon(i as ZoneIcon)} />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Дети</legend>
          <label htmlFor={allChildrenId} className="flex cursor-pointer items-center gap-2">
            <input
              id={allChildrenId}
              type="checkbox"
              className="h-4 w-4 rounded border-border accent-primary"
              checked={allChildren}
              onChange={(e) => setAllChildren(e.target.checked)}
            />
            <span className="text-sm text-foreground">Все дети, включая будущих</span>
          </label>
          {allChildren ? (
            <p className="text-xs text-muted-foreground">
              Зона будет работать для всех детей семьи, в том числе добавленных позже.
            </p>
          ) : kids.length === 0 ? (
            <p className="text-xs text-destructive">
              В семье пока нет детей — включите «Все дети», чтобы зона заработала, когда ребёнок
              появится.
            </p>
          ) : (
            <div className="space-y-1 pl-6">
              {kids.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={childIds.includes(c.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setChildIds((prev) => {
                        const rest = prev.filter((id) => id !== c.id);
                        return checked ? [...rest, c.id] : rest;
                      });
                    }}
                  />
                  <span className="text-sm text-foreground">{c.name}</span>
                </label>
              ))}
              {noChildrenSelected && (
                <p className="text-xs text-destructive">Выберите хотя бы одного ребёнка.</p>
              )}
            </div>
          )}
        </fieldset>

        <div className="space-y-3">
          <ScheduleFields value={schedule} onChange={setSchedule} />
          <ArrivalFields value={arrival} onChange={setArrival} />
          {rulesOn && (
            <TimeZoneNote
              browserTz={browserTz}
              zoneTz={initial?.schedule || initial?.arrival ? initial.timezone : null}
            />
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={onSubmit} disabled={saving || noChildrenSelected || rulesInvalid}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </DialogFooter>
    </>
  );
}
