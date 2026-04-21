'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, MapPin } from 'lucide-react';
import { locationsApi, type TripDto, type TripPointDto } from '@/lib/api/locations';
import { ChildMap } from '@/components/locations/child-map';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ru', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

function fmtDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const sec = Math.max(1, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec} сек`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function fmtDistance(m: number): string {
  if (m < 1000) return `${m} м`;
  return `${(m / 1000).toFixed(1)} км`;
}

export default function HistoryClient({ childId }: { childId: string }): ReactElement {
  const tripsQ = useQuery({
    queryKey: ['trips', 'list', childId],
    queryFn: () => locationsApi.getTrips(childId),
    staleTime: 30_000,
  });

  const [selectedTrip, setSelectedTrip] = useState<TripDto | null>(null);

  const pointsQ = useQuery({
    queryKey: ['trips', 'points', childId, selectedTrip?.id],
    queryFn: () =>
      selectedTrip ? locationsApi.getTripPoints(childId, selectedTrip.id) : Promise.resolve(null),
    enabled: !!selectedTrip,
    staleTime: 60_000,
  });

  const trips = tripsQ.data?.trips ?? [];

  return (
    <div className="flex h-[calc(100vh-49px)]">
      <aside className="w-96 overflow-y-auto border-r border-zinc-200 bg-white">
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
          <Link
            href="/cabinet"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            title="Назад к карте"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-base font-semibold text-zinc-900">История передвижений</h1>
        </div>

        {tripsQ.isPending ? (
          <div className="px-4 py-6 text-sm text-zinc-500">Загрузка…</div>
        ) : trips.length === 0 ? (
          <div className="px-4 py-6 text-sm text-zinc-500">
            Завершённых поездок пока нет. Поездка попадёт сюда, когда ребёнок остановится на месте
            дольше 30 минут.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {trips.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedTrip(t)}
                  className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-zinc-50 ${
                    selectedTrip?.id === t.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-900">
                      {fmtDate(t.startedAt)}
                      {t.endedAt && ` → ${fmtDate(t.endedAt)}`}
                    </span>
                    {t.isActive && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
                        Идёт
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {fmtDuration(t.startedAt, t.endedAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {fmtDistance(t.distanceM)}
                    </span>
                    <span>{t.pointsCount} точек</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="relative flex-1 overflow-hidden bg-zinc-50">
        {selectedTrip ? (
          <TripMapPreview
            points={pointsQ.data?.points ?? []}
            loading={pointsQ.isPending}
            trip={selectedTrip}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-zinc-500">
            Выберите поездку слева, чтобы увидеть её маршрут.
          </div>
        )}
      </div>
    </div>
  );
}

function TripMapPreview({
  points,
  loading,
  trip,
}: {
  points: TripPointDto[];
  loading: boolean;
  trip: TripDto;
}): ReactElement {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Загружаем маршрут…
      </div>
    );
  }
  if (points.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
        В этой поездке не сохранилось точек координат.
      </div>
    );
  }
  const last = points[points.length - 1];
  return (
    <ChildMap
      childName={`Поездка ${fmtDate(trip.startedAt)}`}
      latest={{
        lat: last.lat,
        lon: last.lon,
        recordedAt: last.recordedAt,
        serverReceivedAt: last.recordedAt,
        accuracy: null,
        altitude: null,
        speed: null,
        bearing: null,
        batteryLevel: null,
        isCharging: null,
        provider: null,
        networkType: null,
        wifiSsid: null,
        mobileOperator: null,
        ageSec: 0,
      }}
      track={points.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        recordedAt: p.recordedAt,
        accuracy: null,
        speed: null,
      }))}
      onMapError={() => {
        /* no-op для превью */
      }}
    />
  );
}
