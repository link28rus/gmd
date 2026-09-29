// apps/web/app/cabinet/zones/components/zone-rules-fields.tsx
// Блоки редактора зоны «Расписание уведомлений» и «Не пришёл к сроку» (этап 2).
'use client';

import { useId, type ReactElement, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ARRIVAL_GRACE_DEFAULT,
  ARRIVAL_GRACE_MAX,
  ARRIVAL_GRACE_MIN,
  type Zone,
  type ZoneArrival,
  type ZoneSchedule,
} from '@/lib/api/zones';
import { ToggleSwitch } from './toggle-switch';
import {
  DAYS_WORKDAYS,
  WEEKDAY_SHORT,
  hasDay,
  hhmmToMinutes,
  isOvernight,
  minutesToHHMM,
  toggleDay,
} from './zone-format';

const WEEKDAY_FULL = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
] as const;

// ---------------------------------------------------------------------------
// Черновики формы и перевод в payload
// ---------------------------------------------------------------------------

export interface ScheduleDraft {
  on: boolean;
  daysMask: number;
  /** «HH:MM» из input type=time; пусто — не задано. */
  start: string;
  end: string;
}

export interface ArrivalDraft {
  on: boolean;
  deadline: string;
  daysMask: number;
  /** Строка из input type=number — проверяется при сохранении. */
  grace: string;
}

export function initialScheduleDraft(zone?: Zone): ScheduleDraft {
  const s = zone?.schedule;
  return {
    on: !!s,
    daysMask: s?.daysMask ?? DAYS_WORKDAYS,
    start: minutesToHHMM(s?.startMin ?? 8 * 60),
    end: minutesToHHMM(s?.endMin ?? 15 * 60),
  };
}

export function initialArrivalDraft(zone?: Zone): ArrivalDraft {
  const a = zone?.arrival;
  return {
    on: !!a,
    deadline: minutesToHHMM(a?.deadlineMin ?? 8 * 60 + 30),
    daysMask: a?.daysMask ?? DAYS_WORKDAYS,
    grace: String(a?.graceMin ?? ARRIVAL_GRACE_DEFAULT),
  };
}

/** Текст ошибки блока расписания или null. Выключенный блок всегда валиден. */
export function scheduleError(d: ScheduleDraft): string | null {
  if (!d.on) return null;
  if ((d.daysMask & 0b1111111) === 0) return 'Выберите хотя бы один день.';
  const start = hhmmToMinutes(d.start);
  const end = hhmmToMinutes(d.end);
  if (start === null || end === null) return 'Укажите время «с» и «до».';
  if (start === end) return 'Время «с» и «до» не должны совпадать.';
  return null;
}

export function arrivalError(d: ArrivalDraft): string | null {
  if (!d.on) return null;
  if (hhmmToMinutes(d.deadline) === null) return 'Укажите время срока.';
  if ((d.daysMask & 0b1111111) === 0) return 'Выберите хотя бы один день.';
  const g = Number(d.grace);
  if (
    d.grace.trim() === '' ||
    !Number.isInteger(g) ||
    g < ARRIVAL_GRACE_MIN ||
    g > ARRIVAL_GRACE_MAX
  ) {
    return `Запас — целое число минут от ${ARRIVAL_GRACE_MIN} до ${ARRIVAL_GRACE_MAX}.`;
  }
  return null;
}

/** Выключенный блок = null («снять»). Вызывать только при scheduleError(d) === null. */
export function schedulePayload(d: ScheduleDraft): ZoneSchedule | null {
  if (!d.on) return null;
  return {
    daysMask: d.daysMask,
    startMin: hhmmToMinutes(d.start) ?? 0,
    endMin: hhmmToMinutes(d.end) ?? 0,
  };
}

export function arrivalPayload(d: ArrivalDraft): ZoneArrival | null {
  if (!d.on) return null;
  return {
    deadlineMin: hhmmToMinutes(d.deadline) ?? 0,
    daysMask: d.daysMask,
    graceMin: Number(d.grace),
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function DayChips({
  mask,
  onChange,
  label,
}: {
  mask: number;
  onChange: (mask: number) => void;
  label: string;
}): ReactElement {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {WEEKDAY_SHORT.map((d, i) => {
        const on = hasDay(mask, i);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            aria-label={WEEKDAY_FULL[i]}
            onClick={() => onChange(toggleDay(mask, i))}
            className={[
              'h-8 min-w-[2.5rem] rounded-full border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            ].join(' ')}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

function RuleSection({
  title,
  description,
  on,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}): ReactElement {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={titleId} className="text-sm font-medium text-foreground">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <ToggleSwitch checked={on} onChange={onToggle} ariaLabel={title} />
      </div>
      {on && children}
    </section>
  );
}

export function ScheduleFields({
  value,
  onChange,
}: {
  value: ScheduleDraft;
  onChange: (v: ScheduleDraft) => void;
}): ReactElement {
  const startId = useId();
  const endId = useId();
  const error = scheduleError(value);
  const start = hhmmToMinutes(value.start);
  const end = hhmmToMinutes(value.end);
  const overnight = start !== null && end !== null && isOvernight(start, end);

  return (
    <RuleSection
      title="Расписание уведомлений"
      description={
        value.on
          ? 'Push о приходе и уходе — только в эти дни и часы. События в ленте пишутся всегда.'
          : 'Сейчас уведомления о приходе и уходе приходят круглосуточно.'
      }
      on={value.on}
      onToggle={(on) => onChange({ ...value, on })}
    >
      <DayChips
        label="Дни расписания"
        mask={value.daysMask}
        onChange={(daysMask) => onChange({ ...value, daysMask })}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor={startId}>С</Label>
          <Input
            id={startId}
            type="time"
            className="mt-1 w-32"
            value={value.start}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={endId}>До</Label>
          <Input
            id={endId}
            type="time"
            className="mt-1 w-32"
            value={value.end}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
          />
        </div>
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : overnight ? (
        <p className="text-xs text-muted-foreground">
          Окно через полночь: с {value.start} до {value.end} следующего дня.
        </p>
      ) : null}
    </RuleSection>
  );
}

export function ArrivalFields({
  value,
  onChange,
}: {
  value: ArrivalDraft;
  onChange: (v: ArrivalDraft) => void;
}): ReactElement {
  const deadlineId = useId();
  const graceId = useId();
  const error = arrivalError(value);

  return (
    <RuleSection
      title="Не пришёл к сроку"
      description="Push, если ребёнок не пришёл в зону к указанному времени. Проверяется для всех детей зоны."
      on={value.on}
      onToggle={(on) => onChange({ ...value, on })}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor={deadlineId}>Срок</Label>
          <Input
            id={deadlineId}
            type="time"
            className="mt-1 w-32"
            value={value.deadline}
            onChange={(e) => onChange({ ...value, deadline: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={graceId}>Запас, мин</Label>
          <Input
            id={graceId}
            type="number"
            inputMode="numeric"
            min={ARRIVAL_GRACE_MIN}
            max={ARRIVAL_GRACE_MAX}
            step={1}
            className="mt-1 w-24"
            value={value.grace}
            onChange={(e) => onChange({ ...value, grace: e.target.value })}
          />
        </div>
      </div>
      <DayChips
        label="Дни проверки срока"
        mask={value.daysMask}
        onChange={(daysMask) => onChange({ ...value, daysMask })}
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Проверка — через {Number(value.grace)} мин после срока.
        </p>
      )}
    </RuleSection>
  );
}

/** Подпись о поясе; предупреждает, если зона была настроена в другом поясе. */
export function TimeZoneNote({
  browserTz,
  zoneTz,
}: {
  browserTz: string | null;
  zoneTz: string | null | undefined;
}): ReactElement {
  if (!browserTz) {
    return (
      <p className="text-xs text-destructive">
        Браузер не сообщил часовой пояс — расписание и срок сохранить не получится.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Время по поясу {browserTz}.
      {zoneTz && zoneTz !== browserTz && (
        <> Раньше время зоны было задано по поясу {zoneTz} — после сохранения будет по вашему.</>
      )}
    </p>
  );
}
