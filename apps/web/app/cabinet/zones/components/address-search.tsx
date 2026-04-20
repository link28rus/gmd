'use client';

import { useEffect, useState } from 'react';
import { geocode, GeocodeHit } from '@/lib/api/geocode';
import { Input } from '@/components/ui/input';

interface Props {
  value: string;
  onChange: (q: string) => void;
  onPick: (hit: GeocodeHit) => void;
}

export function AddressSearch({ value, onChange, onPick }: Props) {
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      geocode(value).then((items) => {
        setHits(items);
        setOpen(items.length > 0);
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [value]);

  return (
    <div className="relative">
      <Input
        placeholder="🔍 Адрес"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && hits.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow max-h-48 overflow-auto">
          {hits.map((h, i) => (
            <li
              key={i}
              className="px-3 py-2 hover:bg-accent cursor-pointer text-sm"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(h);
                setOpen(false);
                onChange(h.name);
              }}
            >
              <div className="font-medium">{h.name}</div>
              {h.description && (
                <div className="text-xs text-muted-foreground">{h.description}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
