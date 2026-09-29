'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { geocode, type GeocodeHit, type GeocodeNear } from '@/lib/api/geocode';
import { Input } from '@/components/ui/input';

interface Props {
  value: string;
  onChange: (q: string) => void;
  onPick: (hit: GeocodeHit) => void;
  /** Смещать результаты к этой точке (центр карты редактора). */
  near?: GeocodeNear | null;
}

const DEBOUNCE_MS = 400;

export function AddressSearch({ value, onChange, onPick, near }: Props) {
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  // Центр читаем в момент запроса: смена центра (в т.ч. после выбора адреса)
  // не должна сама по себе перезапускать поиск.
  const nearRef = useRef(near);
  nearRef.current = near;
  const focusedRef = useRef(false);
  /** Текст, подставленный выбором из списка, — по нему повторно не ищем. */
  const pickedRef = useRef<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const text = value.trim();
    if (text.length < 2) {
      setHits([]);
      setOpen(false);
      setFailed(false);
      return;
    }
    if (pickedRef.current !== null && pickedRef.current === value) return;
    pickedRef.current = null;

    const seq = ++seqRef.current;
    const handle = setTimeout(() => {
      geocode(value, nearRef.current)
        .then((items) => {
          if (seq !== seqRef.current) return;
          setFailed(false);
          setHits(items);
          setActive(-1);
          setOpen(focusedRef.current && items.length > 0);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setHits([]);
          setOpen(false);
          setFailed(true);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value]);

  const pick = (h: GeocodeHit): void => {
    pickedRef.current = h.name;
    seqRef.current++; // отменяет ответ, который мог ещё лететь
    setOpen(false);
    setActive(-1);
    onChange(h.name);
    onPick(h);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(hits[active]);
    }
  };

  return (
    <div className="relative">
      <Input
        placeholder="🔍 Адрес"
        aria-label="Поиск адреса"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          focusedRef.current = true;
          if (hits.length > 0 && pickedRef.current === null) setOpen(true);
        }}
        onBlur={() => {
          focusedRef.current = false;
          setTimeout(() => setOpen(false), 150);
        }}
      />
      {failed && (
        <p className="mt-1 text-xs text-destructive" role="status">
          Поиск адреса временно недоступен. Укажите точку кликом по карте.
        </p>
      )}
      {open && hits.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow"
        >
          {hits.map((h, i) => (
            <li
              key={`${h.lat},${h.lon},${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 text-sm hover:bg-accent ${i === active ? 'bg-accent' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(h);
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
