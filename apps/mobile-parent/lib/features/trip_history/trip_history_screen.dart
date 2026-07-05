import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../children/child_models.dart';
import '../children/children_providers.dart';

/// Экран «История передвижений» — список завершённых (и активной) поездок
/// ребёнка. Тап по поездке открывает [TripRouteScreen] с картой маршрута.
///
/// Порт `apps/web/app/cabinet/children/[id]/history/history-client.tsx`,
/// адаптированный под мобильный вертикальный layout: вместо «список слева +
/// карта справа» — список на весь экран + отдельный экран маршрута по тапу.
class TripHistoryScreen extends ConsumerWidget {
  const TripHistoryScreen({
    super.key,
    required this.childId,
    required this.childName,
  });

  final String childId;
  final String childName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tripsAsync = ref.watch(childTripsProvider(childId));

    return Scaffold(
      appBar: AppBar(
        title: Text('История — $childName'),
        actions: [
          IconButton(
            tooltip: 'Обновить',
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(childTripsProvider(childId)),
          ),
        ],
      ),
      body: tripsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorState(
          error: err,
          onRetry: () => ref.invalidate(childTripsProvider(childId)),
        ),
        data: (trips) {
          if (trips.isEmpty) return const _EmptyState();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(childTripsProvider(childId)),
            child: ListView.separated(
              itemCount: trips.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, i) => _TripTile(
                trip: trips[i],
                childId: childId,
                childName: childName,
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Карточка одной поездки: временной интервал + длительность/дистанция/точки.
class _TripTile extends StatelessWidget {
  const _TripTile({
    required this.trip,
    required this.childId,
    required this.childName,
  });

  final Trip trip;
  final String childId;
  final String childName;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: () {
        final encoded = Uri.encodeQueryComponent(childName);
        context.push(
          '/home/child/$childId/history/${trip.id}?name=$encoded',
          extra: trip,
        );
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          _tripTitle(trip),
                          style: theme.textTheme.bodyLarge?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (trip.isActive) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFFDCFCE7),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: const Text(
                            'Идёт',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: Color(0xFF166534),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  DefaultTextStyle.merge(
                    style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ) ??
                        const TextStyle(fontSize: 12),
                    child: Row(
                      children: [
                        const Icon(Icons.schedule, size: 14),
                        const SizedBox(width: 4),
                        Text(_fmtDuration(trip.startedAt, trip.endedAt)),
                        const SizedBox(width: 12),
                        const Icon(Icons.route_outlined, size: 14),
                        const SizedBox(width: 4),
                        Text(_fmtDistance(trip.distanceM)),
                        const SizedBox(width: 12),
                        Text('${trip.pointsCount} точек'),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right,
              size: 20,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.timeline_outlined,
              size: 48,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 16),
            Text(
              'Поездок пока нет',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Поездка появится здесь, когда ребёнок пройдёт заметное '
              'расстояние и остановится дольше 30 минут.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48, color: Colors.red.shade400),
            const SizedBox(height: 16),
            Text(
              'Не удалось загрузить историю',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              '$error',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
              textAlign: TextAlign.center,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 16),
            FilledButton.tonal(
              onPressed: onRetry,
              child: const Text('Повторить'),
            ),
          ],
        ),
      ),
    );
  }
}

const _months = <String>[
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

String _fmtDateTime(DateTime dt) {
  final hh = dt.hour.toString().padLeft(2, '0');
  final mm = dt.minute.toString().padLeft(2, '0');
  return '${dt.day} ${_months[dt.month - 1]}, $hh:$mm';
}

/// Заголовок поездки: «21 июн, 14:30 → 15:10» (если конец в тот же день —
/// показываем только время конца, иначе полную дату).
String _tripTitle(Trip trip) {
  final start = _fmtDateTime(trip.startedAt);
  final end = trip.endedAt;
  if (end == null) return start;
  final sameDay = end.year == trip.startedAt.year &&
      end.month == trip.startedAt.month &&
      end.day == trip.startedAt.day;
  final endText = sameDay
      ? '${end.hour.toString().padLeft(2, '0')}:${end.minute.toString().padLeft(2, '0')}'
      : _fmtDateTime(end);
  return '$start → $endText';
}

String _fmtDuration(DateTime start, DateTime? end) {
  final endMs = (end ?? DateTime.now()).millisecondsSinceEpoch;
  final rawSec = ((endMs - start.millisecondsSinceEpoch) / 1000).round();
  final sec = rawSec < 1 ? 1 : rawSec;
  if (sec < 60) return '$sec сек';
  final min = (sec / 60).round();
  if (min < 60) return '$min мин';
  final hours = min ~/ 60;
  final rest = min % 60;
  return rest > 0 ? '$hours ч $rest мин' : '$hours ч';
}

String _fmtDistance(int m) {
  if (m < 1000) return '$m м';
  return '${(m / 1000).toStringAsFixed(1)} км';
}
