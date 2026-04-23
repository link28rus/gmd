'use client';

import { useState } from 'react';
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
import type { Zone, ZoneColor, ZoneIcon } from '@/lib/api/zones';
import type { GeocodeHit } from '@/lib/api/geocode';
import { toast } from 'sonner';

export interface KidOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Available children for zone assignment */
  kids: KidOption[];
  initial?: Zone;
  onSaved: (z: Zone) => void;
}

const DEFAULT_LAT = 55.75;
const DEFAULT_LON = 37.62;
const DEFAULT_RADIUS = 250;
const DEFAULT_COLOR: ZoneColor = '#22c55e';
const DEFAULT_ICON: ZoneIcon = 'home';

export function ZoneEditorDialog({ open, onOpenChange, kids, initial, onSaved }: Props) {
  const [address, setAddress] = useState(initial?.address ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState<ZoneColor>(initial?.color ?? DEFAULT_COLOR);
  const [icon, setIcon] = useState<ZoneIcon>(initial?.icon ?? DEFAULT_ICON);
  const [centerLat, setCenterLat] = useState(initial?.centerLat ?? DEFAULT_LAT);
  const [centerLon, setCenterLon] = useState(initial?.centerLon ?? DEFAULT_LON);
  const [radius, setRadius] = useState(initial?.radius ?? DEFAULT_RADIUS);
  const [childIds, setChildIds] = useState<string[]>(initial?.childIds ?? kids.map((c) => c.id));

  const create = useCreateZone();
  const update = useUpdateZone();
  const saving = create.isPending || update.isPending;

  const handleAddressPick = (hit: GeocodeHit) => {
    setCenterLat(hit.lat);
    setCenterLon(hit.lon);
    if (!name.trim()) setName(hit.name.split(',')[0].trim());
  };

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error('Укажите имя зоны');
      return;
    }
    const payload = {
      name: name.trim(),
      color,
      icon,
      centerLat,
      centerLon,
      radius,
      childIds,
    };
    try {
      const saved = initial
        ? await update.mutateAsync({ id: initial.id, patch: payload })
        : await create.mutateAsync(payload);
      toast.success(initial ? 'Зона обновлена' : 'Зона создана');
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      const msg =
        (e as { body?: { message?: string } }).body?.message ??
        (e instanceof Error ? e.message : null) ??
        'Ошибка сохранения';
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{initial ? 'Изменить зону' : 'Новая зона'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <AddressSearch value={address} onChange={setAddress} onPick={handleAddressPick} />

          <ZoneEditorMap
            centerLat={centerLat}
            centerLon={centerLon}
            radius={radius}
            color={color}
            onCenterChange={(lat, lon) => {
              setCenterLat(lat);
              setCenterLon(lon);
            }}
            onRadiusChange={setRadius}
          />

          <p className="text-sm text-muted-foreground">Радиус: {radius} м</p>

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

          {kids.length > 0 && (
            <div>
              <Label>Дети</Label>
              <div className="mt-1 space-y-1">
                {kids.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={childIds.includes(c.id)}
                      onChange={(e) => {
                        setChildIds((prev) =>
                          e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                        );
                      }}
                    />
                    <span className="text-sm">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
