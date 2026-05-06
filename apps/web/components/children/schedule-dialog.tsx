'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DAYS_MASK_ALL,
  DAYS_MASK_WEEKDAYS,
  DAYS_MASK_WEEKEND,
  ISO_WEEKDAY_LABELS_RU,
  type AppBlockScheduleDto,
} from '@/lib/api/app-control';
import { useCreateSchedule, useUpdateSchedule } from '@/lib/hooks/use-app-control';
import { ApiError } from '@/lib/api/client';

interface Props {
  childId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** undefined — режим создания; объект — режим редактирования. */
  schedule?: AppBlockScheduleDto;
}

function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((s) => Number.parseInt(s, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

function hhmmFromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

const DEFAULT_NAME = 'Сон';
const DEFAULT_START = 22 * 60; // 22:00
const DEFAULT_END = 8 * 60; // 08:00 → cross-midnight
const DEFAULT_MASK = DAYS_MASK_ALL;

export function ScheduleDialog({ childId, open, onOpenChange, schedule }: Props): ReactElement {
  const isEdit = schedule !== undefined;

  const [name, setName] = useState<string>(schedule?.name ?? DEFAULT_NAME);
  const [daysMask, setDaysMask] = useState<number>(schedule?.daysMask ?? DEFAULT_MASK);
  const [startHHMM, setStartHHMM] = useState<string>(
    schedule ? hhmmFromMinutes(schedule.startMin) : hhmmFromMinutes(DEFAULT_START),
  );
  const [endHHMM, setEndHHMM] = useState<string>(
    schedule ? hhmmFromMinutes(schedule.endMin) : hhmmFromMinutes(DEFAULT_END),
  );

  // При смене редактируемой записи (например, родитель открыл одно расписание,
  // закрыл, открыл другое) сбрасываем форму.
  useEffect(() => {
    if (!open) return;
    setName(schedule?.name ?? DEFAULT_NAME);
    setDaysMask(schedule?.daysMask ?? DEFAULT_MASK);
    setStartHHMM(schedule ? hhmmFromMinutes(schedule.startMin) : hhmmFromMinutes(DEFAULT_START));
    setEndHHMM(schedule ? hhmmFromMinutes(schedule.endMin) : hhmmFromMinutes(DEFAULT_END));
  }, [open, schedule]);

  const create = useCreateSchedule(childId);
  const update = useUpdateSchedule(childId);
  const isPending = create.isPending || update.isPending;

  const startMin = useMemo(() => minutesFromHHMM(startHHMM), [startHHMM]);
  const endMin = useMemo(() => minutesFromHHMM(endHHMM), [endHHMM]);
  const crossesMidnight = startMin > endMin;
  const zeroDuration = startMin === endMin;
  const noDays = daysMask === 0;
  const trimmedName = name.trim();
  const validName = trimmedName.length > 0 && trimmedName.length <= 64;
  const valid = validName && !zeroDuration && !noDays;

  function toggleDay(weekday: number): void {
    const bit = 1 << (weekday - 1);
    setDaysMask((m) => (m & bit ? m & ~bit : m | bit));
  }

  function onSubmit(): void {
    if (!valid || isPending) return;
    const body = {
      name: trimmedName,
      daysMask,
      startMin,
      endMin,
    };

    const onErr = (err: unknown): void => {
      if (err instanceof ApiError && err.code === 'schedule_limit_reached') {
        toast.error('Достигнут лимит расписаний (10 на ребёнка)');
      } else if (err instanceof ApiError && err.code === 'no_active_device') {
        toast.error('У ребёнка нет привязанного устройства');
      } else {
        toast.error(err instanceof Error ? err.message : 'Не удалось сохранить расписание');
      }
    };

    if (isEdit) {
      update.mutate(
        { scheduleId: schedule!.id, body },
        {
          onSuccess: () => {
            toast.success('Расписание сохранено');
            onOpenChange(false);
          },
          onError: onErr,
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          toast.success('Расписание создано');
          onOpenChange(false);
        },
        onError: onErr,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            {isEdit ? 'Изменить расписание' : 'Новое расписание блокировки'}
          </DialogTitle>
          <DialogDescription>
            В выбранном временном окне на устройстве ребёнка будут заблокированы все приложения,
            кроме всегда разрешённых (whitelist) и системных. Звонки и SMS работают.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Имя */}
          <div className="space-y-1.5">
            <label htmlFor="sched-name" className="text-xs font-medium text-foreground">
              Название
            </label>
            <input
              id="sched-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              placeholder="Сон"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
          </div>

          {/* Дни недели */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Дни недели</p>
            <div className="flex flex-wrap gap-1.5">
              {ISO_WEEKDAY_LABELS_RU.map((label, idx) => {
                const weekday = idx + 1;
                const bit = 1 << idx;
                const active = (daysMask & bit) !== 0;
                return (
                  <button
                    key={weekday}
                    type="button"
                    onClick={() => toggleDay(weekday)}
                    aria-pressed={active}
                    className={
                      'h-9 w-9 rounded-full text-xs font-medium transition-colors ' +
                      (active
                        ? 'bg-foreground text-background'
                        : 'border border-border bg-card text-foreground hover:bg-muted')
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setDaysMask(DAYS_MASK_WEEKDAYS)}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground transition-colors hover:bg-muted"
              >
                Будни
              </button>
              <button
                type="button"
                onClick={() => setDaysMask(DAYS_MASK_WEEKEND)}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground transition-colors hover:bg-muted"
              >
                Выходные
              </button>
              <button
                type="button"
                onClick={() => setDaysMask(DAYS_MASK_ALL)}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground transition-colors hover:bg-muted"
              >
                Каждый день
              </button>
            </div>
          </div>

          {/* Время */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="sched-start" className="text-xs font-medium text-foreground">
                С
              </label>
              <input
                id="sched-start"
                type="time"
                value={startHHMM}
                step={300}
                onChange={(e) => setStartHHMM(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-foreground focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="sched-end" className="text-xs font-medium text-foreground">
                До
              </label>
              <input
                id="sched-end"
                type="time"
                value={endHHMM}
                step={300}
                onChange={(e) => setEndHHMM(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-foreground focus:outline-none"
              />
            </div>
          </div>

          {crossesMidnight && (
            <p className="text-xs text-muted-foreground">
              Окно пересекает полночь: с {startHHMM} вечера до {endHHMM} следующего утра.
            </p>
          )}
          {zeroDuration && (
            <p className="text-xs text-red-600">Время начала и окончания должны различаться.</p>
          )}
          {noDays && <p className="text-xs text-red-600">Выберите хотя бы один день недели.</p>}
          {!validName && trimmedName.length > 0 && (
            <p className="text-xs text-red-600">Название не должно быть длиннее 64 символов.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={!valid || isPending}>
            {isPending ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
