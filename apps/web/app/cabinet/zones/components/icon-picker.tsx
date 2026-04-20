'use client';

const ICONS = [
  { id: 'home', emoji: '🏠', label: 'Дом' },
  { id: 'school', emoji: '🏫', label: 'Школа' },
  { id: 'sport', emoji: '⚽', label: 'Спорт' },
  { id: 'art', emoji: '🎨', label: 'Творчество' },
  { id: 'hospital', emoji: '🏥', label: 'Больница' },
  { id: 'shop', emoji: '🏪', label: 'Магазин' },
  { id: 'music', emoji: '🎵', label: 'Музыка' },
  { id: 'other', emoji: '📍', label: 'Другое' },
] as const;

interface Props {
  value: string;
  onChange: (icon: string) => void;
}

export function IconPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Иконка зоны">
      {ICONS.map((i) => (
        <button
          key={i.id}
          type="button"
          role="radio"
          aria-checked={value === i.id}
          aria-label={i.label}
          onClick={() => onChange(i.id)}
          className={`p-2 rounded-md border-2 text-2xl transition ${
            value === i.id ? 'border-primary bg-accent' : 'border-muted'
          }`}
        >
          {i.emoji}
        </button>
      ))}
    </div>
  );
}
