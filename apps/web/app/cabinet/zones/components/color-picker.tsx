'use client';

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#64748b'] as const;

interface Props {
  value: string;
  onChange: (c: string) => void;
}

export function ColorPicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Цвет зоны">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Цвет ${c}`}
          onClick={() => onChange(c)}
          className={`w-8 h-8 rounded-full border-2 transition ${
            value === c ? 'border-foreground scale-110' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
