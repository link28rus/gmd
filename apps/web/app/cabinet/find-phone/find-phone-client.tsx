// apps/web/app/cabinet/find-phone/find-phone-client.tsx
// v0.73.0 «Найти телефон»: родитель потерял свой телефон, открывает кабинет —
// видит телефон на карте, маршрут за выбранный день (30 дней), заряд, время
// последней связи и может заставить телефон звонить 60 секунд даже в
// беззвучном режиме. Показываются только телефоны текущего пользователя.
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Battery, BatteryCharging, BellRing, Smartphone } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { refreshAccessToken } from '@/lib/auth/refresh-singleflight';
import { ApiError } from '@/lib/api/client';
import {
  findPhoneApi,
  type MyPhone,
  type MyPhonesResponse,
  type PhoneTrackPoint,
} from '@/lib/api/find-phone';
import {
  ageSecSince,
  batteryText,
  dayRangeIso,
  drawableTrack,
  isSignalActive,
  phoneLabel,
  platformLabel,
  pollIntervalMs,
  signalStatusText,
} from '@/lib/find-phone/find-phone-format';
import { formatAgeShort } from '@/lib/date/age-format';
import { isToday, todayIso } from '@/lib/date/day-bounds';
import { DateSelector } from '@/components/locations/date-selector';
import { PhoneMap } from '@/components/find-phone/phone-map';
import { Button } from '@/components/ui/button';

const DEVICES_KEY = ['find-phone', 'devices'] as const;
const EMPTY_TRACK: PhoneTrackPoint[] = [];

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

function signalErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Слишком часто, подождите минуту';
    if (e.status === 404) return 'Телефон не найден — обновите страницу';
  }
  return e instanceof Error && e.message ? e.message : 'Не удалось отправить сигнал';
}

export default function FindPhoneClient(): ReactElement {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAll = useAuthStore((s) => s.setAll);
  const [bootstrapping, setBootstrapping] = useState(accessToken === null);

  // Тот же bootstrap, что у остальных страниц кабинета: access-токена в
  // памяти нет (свежая вкладка) → обновляем по refresh-cookie.
  useEffect(() => {
    if (accessToken !== null) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await refreshAccessToken();
        if (cancelled) return;
        if (!data || !data.user || !data.family) {
          router.replace('/login');
          return;
        }
        setAll({ accessToken: data.accessToken, user: data.user, family: data.family });
      } catch {
        router.replace('/login');
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const devicesQ = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: findPhoneApi.getMyDevices,
    enabled: !bootstrapping,
    // Пока сигнал в пути или телефон звонит — каждые 5 с, иначе раз в 30 с.
    refetchInterval: (q) => pollIntervalMs(q.state.data?.items ?? []),
    retry: 1,
  });

  useEffect(() => {
    if (devicesQ.error) toast.error('Не удалось загрузить телефоны');
  }, [devicesQ.error]);

  const items = devicesQ.data?.items ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((d) => d.id === selectedId) ?? items[0] ?? null;
  const [date, setDate] = useState(todayIso());

  const trackQ = useQuery({
    queryKey: ['find-phone', 'track', selected?.id, date],
    queryFn: () => {
      const [from, to] = dayRangeIso(date);
      return findPhoneApi.getTrack(selected!.id, from, to);
    },
    enabled: !!selected,
    staleTime: isToday(date) ? 10_000 : 5 * 60_000,
    refetchInterval: isToday(date) ? 30_000 : false,
    retry: 1,
  });

  const track = trackQ.data?.items ?? EMPTY_TRACK;
  const drawable = useMemo(() => drawableTrack(track), [track]);

  if (bootstrapping || devicesQ.isPending) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      </div>
    );
  }

  if (devicesQ.isError && !devicesQ.data) {
    return (
      <div className="mx-auto max-w-xl p-6 text-center text-sm text-muted-foreground">
        Не удалось загрузить телефоны.{' '}
        <button
          type="button"
          onClick={() => devicesQ.refetch()}
          className="text-foreground underline underline-offset-4"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 p-6 text-center">
        <Smartphone className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Найти телефон</h1>
        <p className="text-sm text-muted-foreground">
          Здесь появится телефон, на котором вы вошли в приложение «Перископ Родителя»
        </p>
        <Link
          href="/cabinet/download"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-muted"
        >
          Скачать приложение
        </Link>
      </div>
    );
  }

  const trackEmpty = !trackQ.isPending && !trackQ.isError && drawable.length === 0;

  return (
    <div className="flex flex-col md:h-[calc(100vh-57px)] md:flex-row">
      <aside className="border-b border-border bg-card md:w-96 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-base font-semibold text-foreground">Найти телефон</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ваши телефоны с приложением «Перископ Родителя»
          </p>
        </div>

        {items.length > 1 && (
          <ul className="flex flex-col gap-2 border-b border-border p-3">
            {items.map((d) => (
              <li key={d.id}>
                <DeviceCard
                  phone={d}
                  active={d.id === selected.id}
                  onSelect={() => setSelectedId(d.id)}
                />
              </li>
            ))}
          </ul>
        )}

        <PhonePanel phone={selected} />
      </aside>

      <section className="flex h-[65vh] min-h-[360px] flex-col md:h-auto md:flex-1">
        <DateSelector value={date} onChange={setDate} />
        <div className="relative flex-1 overflow-hidden bg-muted">
          {selected.latest === null && trackEmpty ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Телефон ещё не присылал координаты. Откройте на нём «Перископ Родителя» и разрешите
              доступ к геолокации.
            </div>
          ) : (
            <>
              <PhoneMap
                viewKey={`${selected.id}|${date}`}
                phoneName={phoneLabel(selected)}
                latest={selected.latest}
                ringing={selected.signal?.status === 'ringing'}
                track={track}
                drawable={drawable}
                trackLoading={trackQ.isPending}
              />
              {(trackEmpty || trackQ.isError) && (
                <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[500] flex justify-center px-4">
                  <div className="rounded-full border border-border bg-card/95 px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
                    {trackQ.isError
                      ? 'Не удалось загрузить маршрут за этот день'
                      : 'За этот день перемещений нет'}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function DeviceCard({
  phone,
  active,
  onSelect,
}: {
  phone: MyPhone;
  active: boolean;
  onSelect: () => void;
}): ReactElement {
  const platform = platformLabel(phone.platform);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
        active ? 'border-emerald-600 bg-accent/30' : 'border-border bg-card hover:bg-muted'
      }`}
    >
      <Smartphone className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{phoneLabel(phone)}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[
            platform,
            phone.lastSeenAt
              ? `на связи ${formatAgeShort(ageSecSince(phone.lastSeenAt))}`
              : 'ещё не выходил на связь',
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      {isSignalActive(phone.signal) && (
        <BellRing className="h-4 w-4 shrink-0 text-red-600" aria-label="Сигнал активен" />
      )}
    </button>
  );
}

function PhonePanel({ phone }: { phone: MyPhone }): ReactElement {
  const qc = useQueryClient();
  const latest = phone.latest;
  const battery = latest ? batteryText(latest.batteryLevel, latest.isCharging) : null;
  const status = signalStatusText(phone.signal);
  const active = isSignalActive(phone.signal);

  const signalM = useMutation({
    mutationFn: () => findPhoneApi.signal(phone.id),
    onSuccess: (res) => {
      // Сразу показываем «ждём ответа», не дожидаясь опроса; опрос
      // переключится на 5 с и подтянет ringing/expired.
      qc.setQueryData<MyPhonesResponse>(DEVICES_KEY, (prev) =>
        prev
          ? {
              items: prev.items.map((d) =>
                d.id === phone.id
                  ? {
                      ...d,
                      signal: {
                        id: res.signalId,
                        requestedAt: res.requestedAt,
                        ackedAt: null,
                        status: 'pending',
                      },
                    }
                  : d,
              ),
            }
          : prev,
      );
      void qc.invalidateQueries({ queryKey: DEVICES_KEY });
      toast.success(
        res.pushed
          ? 'Сигнал отправлен'
          : 'Сигнал отправлен — дойдёт, когда телефон выйдет на связь',
      );
    },
    onError: (e) => toast.error(signalErrorMessage(e)),
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-foreground">
            {phoneLabel(phone)}
          </div>
          {battery && (
            <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              {latest?.isCharging ? (
                <BatteryCharging className="h-4 w-4 text-emerald-600" />
              ) : (
                <Battery className="h-4 w-4" />
              )}
              {battery}
            </div>
          )}
        </div>
      </div>

      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Последняя связь</dt>
          <dd className="text-right text-foreground">
            {phone.lastSeenAt ? formatAgeShort(ageSecSince(phone.lastSeenAt)) : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Место определено</dt>
          <dd className="text-right text-foreground">
            {latest ? (
              <>
                {fmtDateTime(latest.recordedAt)}
                {latest.accuracy !== null && (
                  <span className="text-muted-foreground"> · ±{Math.round(latest.accuracy)} м</span>
                )}
              </>
            ) : (
              'нет данных'
            )}
          </dd>
        </div>
      </dl>

      {!latest && (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Телефон ещё не присылал координаты — на карте его пока нет. Сигнал подать можно.
        </p>
      )}

      <div className="space-y-2">
        <Button
          type="button"
          size="lg"
          className="w-full gap-2 bg-red-600 text-white hover:bg-red-700"
          disabled={signalM.isPending}
          onClick={() => signalM.mutate()}
        >
          <BellRing className="h-5 w-5" />
          {signalM.isPending ? 'Отправляем…' : active ? 'Подать сигнал ещё раз' : 'Подать сигнал'}
        </Button>
        {status && (
          <p
            role="status"
            aria-live="polite"
            className={`text-sm ${
              phone.signal?.status === 'ringing'
                ? 'font-medium text-red-600'
                : phone.signal?.status === 'expired'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-foreground'
            }`}
          >
            {status}
          </p>
        )}
        {!phone.canPush && (
          <p className="text-xs text-muted-foreground">
            Сигнал дойдёт, когда телефон в следующий раз выйдет на связь (до 5 минут).
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Звонок играет на максимальной громкости даже в беззвучном режиме. Остановить — кнопкой в
          уведомлении на телефоне.
        </p>
      </div>

      {phone.appVersion && (
        <p className="text-[11px] text-muted-foreground">
          {[platformLabel(phone.platform), `Перископ Родителя v${phone.appVersion}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
