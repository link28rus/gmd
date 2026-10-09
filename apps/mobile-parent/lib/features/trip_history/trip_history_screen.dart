import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../children/child_models.dart';
import '../children/children_providers.dart';
import '../children/track_gaps.dart';
import '../children/widgets/track_layers.dart';
import '../children/widgets/track_view_menu.dart';
import '../zones/widgets/zone_widgets.dart';
import '../zones/zone_models.dart';
import '../zones/zones_providers.dart';
import 'place_lookup.dart';
import 'trip_history_logic.dart';

/// Шторка: свёрнута — день с лентой суток и первой поездкой, средняя —
/// поездки дня, раскрыта — листать дни.
const _kSheetMin = 0.22;
const _kSheetMid = 0.45;
const _kSheetMax = 0.9;

/// Пока поездка идёт — список и её точки обновляем.
const _kActivePoll = Duration(seconds: 30);

const _tabular = [FontFeature.tabularFigures()];

// Разрыв в данных — серый пунктир, как на главной карте (track_layers.dart).
final _kGapPattern = StrokePattern.dashed(segments: const [8, 6]);
const _kGapColor = Color(0xFF757575);
// v0.80.0: достроенный по дороге участок — пунктир цветом поездки.
final _kInferredPattern = StrokePattern.dashed(segments: const [10, 8]);

/// Экран «История передвижений»: карта дня на весь экран и шторка с днями.
///
/// Как веб-кабинет (`apps/web/app/cabinet/children/[id]/history/`): поездки по
/// дням со сводкой и лентой суток, на карте все маршруты выбранного дня, у
/// каждой поездки свой цвет и номер; выбранная подсвечивается, остальные
/// бледнеют. Места старта/финиша — геозона ребёнка или адрес ближайшего дома.
class TripHistoryScreen extends ConsumerStatefulWidget {
  const TripHistoryScreen({
    super.key,
    required this.childId,
    required this.childName,
    this.initialTripId,
  });

  final String childId;
  final String childName;

  /// Поездка, выбранная при открытии (старая ссылка `/history/:tripId`).
  final String? initialTripId;

  @override
  ConsumerState<TripHistoryScreen> createState() => _TripHistoryScreenState();
}

class _TripHistoryScreenState extends ConsumerState<TripHistoryScreen> {
  final MapController _map = MapController();
  final DraggableScrollableController _sheet = DraggableScrollableController();
  bool _mapReady = false;
  int _tileGen = 0;

  String? _dayKey;
  String? _selectedId;

  /// Для чего уже подогнан масштаб: «день|поездка» и были ли загружены все точки.
  String? _fittedScope;
  bool _fittedComplete = false;

  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _selectedId = widget.initialTripId;
  }

  @override
  void dispose() {
    _poll?.cancel();
    _sheet.dispose();
    super.dispose();
  }

  void _refresh() {
    ref.invalidate(childTripsProvider(widget.childId));
    ref.invalidate(tripPointsProvider);
  }

  /// Таймер обновления живёт, только пока есть идущая поездка.
  void _syncPoll(List<Trip> active) {
    if (active.isEmpty) {
      _poll?.cancel();
      _poll = null;
      return;
    }
    _poll ??= Timer.periodic(_kActivePoll, (_) {
      if (!mounted) return;
      final trips = ref.read(childTripsProvider(widget.childId)).valueOrNull ?? const [];
      ref.invalidate(childTripsProvider(widget.childId));
      for (final t in trips.where((t) => t.isActive)) {
        ref.invalidate(tripPointsProvider((childId: widget.childId, tripId: t.id)));
      }
    });
  }

  void _pickDay(String key) {
    setState(() {
      _dayKey = key;
      _selectedId = null;
    });
  }

  void _pickTrip(TripDay day, String tripId) {
    setState(() {
      final same = _selectedId == tripId && _dayKey == day.key;
      _dayKey = day.key;
      _selectedId = same ? null : tripId;
    });
    // Шторка раскрыта — опускаем, чтобы маршрут был виден.
    if (_sheet.isAttached && _sheet.size > _kSheetMid + 0.01) {
      _sheet.animateTo(
        _kSheetMid,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final tripsAsync = ref.watch(childTripsProvider(widget.childId));
    final zonesAsync = ref.watch(zonesListProvider);
    // null — зоны ещё грузятся: адреса не запрашиваем, точка может оказаться
    // в зоне. Ошибка загрузки зон историю не ломает — просто без зон.
    final List<Zone>? zones = zonesAsync.hasValue
        ? zonesAsync.value!.where((z) => z.appliesTo(widget.childId)).toList()
        : (zonesAsync.hasError ? const [] : null);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('История передвижений'),
            Text(
              '${widget.childName} · последние 30 дней',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Обновить',
            icon: const Icon(Icons.refresh),
            onPressed: _refresh,
          ),
          // v0.80.0: «Как записано» — трек без привязки к дорогам.
          const TrackViewMenuButton(),
        ],
      ),
      body: tripsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorState(error: err, onRetry: _refresh),
        data: (trips) {
          final now = DateTime.now();
          _syncPoll(trips.where((t) => t.isActive).toList());
          if (trips.isEmpty) return const _EmptyState();
          final days = groupTripsByDay(trips, now);
          final day = _resolveDay(days);
          final selected = day.trips.where((t) => t.trip.id == _selectedId).firstOrNull;
          final tracks = <String, TrackData?>{
            for (final t in day.trips)
              t.trip.id: ref
                  .watch(tripPointsProvider((childId: widget.childId, tripId: t.trip.id)))
                  .valueOrNull,
          };

          return LayoutBuilder(
            builder: (context, box) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) _fitIfNeeded(day, selected, tracks, box.biggest);
              });
              return Stack(
                children: [
                  Positioned.fill(
                    child: _buildMap(day, selected, tracks, zones ?? const [], box.biggest),
                  ),
                  if (selected != null)
                    Positioned(
                      top: 12,
                      left: 12,
                      right: 12,
                      child: _SelectedTripCard(
                        item: selected,
                        day: day,
                        track: tracks[selected.trip.id],
                        zones: zones,
                        now: now,
                        onClear: () => setState(() => _selectedId = null),
                      ),
                    ),
                  DraggableScrollableSheet(
                    controller: _sheet,
                    initialChildSize: _kSheetMid,
                    minChildSize: _kSheetMin,
                    maxChildSize: _kSheetMax,
                    snap: true,
                    snapSizes: const [_kSheetMin, _kSheetMid, _kSheetMax],
                    builder: (context, scroll) => _DaysSheet(
                      scroll: scroll,
                      days: days,
                      activeKey: day.key,
                      selectedId: _selectedId,
                      zones: zones,
                      now: now,
                      onPickDay: _pickDay,
                      onPickTrip: _pickTrip,
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  /// Выбранный день; при открытии по ссылке на поездку — день этой поездки.
  TripDay _resolveDay(List<TripDay> days) {
    if (_dayKey == null && _selectedId != null) {
      for (final d in days) {
        if (d.trips.any((t) => t.trip.id == _selectedId)) return d;
      }
    }
    return days.firstWhere((d) => d.key == _dayKey, orElse: () => days.first);
  }

  Widget _buildMap(
    TripDay day,
    DayTrip? selected,
    Map<String, TrackData?> tracks,
    List<Zone> zones,
    Size size,
  ) {
    final first = day.trips.first.trip;
    // Выбранную рисуем последней — поверх остальных.
    final ordered = [
      ...day.trips.where((t) => t != selected),
      ?selected,
    ];
    final polylines = <Polyline>[];
    final markers = <Marker>[];
    for (final item in ordered) {
      final points = tracks[item.trip.id]?.points ?? const <ChildLocation>[];
      final isSel = item == selected;
      final dim = selected != null && !isSel;
      if (points.length >= 2) {
        final split = splitTrackForMap(points);
        if (!dim) {
          for (final gap in split.gaps) {
            polylines.add(Polyline(
              points: [LatLng(gap.from.lat, gap.from.lon), LatLng(gap.to.lat, gap.to.lon)],
              strokeWidth: 2,
              color: _kGapColor,
              pattern: _kGapPattern,
            ));
          }
        }
        // v0.80.0: достроенное по дороге — пунктиром цветом поездки.
        for (final run in split.inferred) {
          polylines.add(Polyline(
            points: run.points.map((p) => LatLng(p.lat, p.lon)).toList(),
            strokeWidth: isSel ? 5 : 4,
            color: dim ? item.color.withValues(alpha: 0.3) : item.color,
            pattern: _kInferredPattern,
          ));
        }
        for (final seg in split.segments) {
          polylines.add(Polyline(
            points: seg.map((p) => LatLng(p.lat, p.lon)).toList(),
            strokeWidth: isSel ? 5 : 4,
            color: dim ? item.color.withValues(alpha: 0.3) : item.color,
            borderStrokeWidth: isSel ? 2.5 : 0,
            borderColor: Colors.white,
          ));
        }
      }
      final start = points.isNotEmpty
          ? LatLng(points.first.lat, points.first.lon)
          : LatLng(item.trip.startLat, item.trip.startLon);
      final end = points.isNotEmpty
          ? LatLng(points.last.lat, points.last.lon)
          : LatLng(item.trip.endLat, item.trip.endLon);
      void onTap() => _pickTrip(day, item.trip.id);
      markers
        ..add(Marker(
          point: start,
          width: 28,
          height: 28,
          child: GestureDetector(
            onTap: onTap,
            child: Center(child: _StartRing(color: item.color, dim: dim)),
          ),
        ))
        ..add(Marker(
          point: end,
          width: 36,
          height: 36,
          child: GestureDetector(
            onTap: onTap,
            child: Center(
              child: _FinishBadge(
                color: item.color,
                ordinal: item.ordinal,
                dim: dim,
                selected: isSel,
              ),
            ),
          ),
        ));
    }

    return FlutterMap(
      mapController: _map,
      options: MapOptions(
        initialCenter: LatLng(first.startLat, first.startLon),
        initialZoom: 14,
        minZoom: 3,
        maxZoom: 18,
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
        ),
        onMapReady: () {
          if (!mounted) return;
          setState(() {
            _mapReady = true;
            _tileGen++;
          });
        },
      ),
      children: [
        TileLayer(
          key: ValueKey('tile_$_tileGen'),
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'pro.periscop.parent',
          maxNativeZoom: 19,
          keepBuffer: 4,
          panBuffer: 2,
        ),
        if (zones.isNotEmpty) CircleLayer(circles: zoneCircles(zones)),
        PolylineLayer(simplificationTolerance: 0, polylines: polylines),
        // Стоянки «П» — только у выбранной поездки (линию рисуем сами выше).
        if (selected != null)
          ...buildTrackLayers(const [], stays: tracks[selected.trip.id]?.stays ?? const []),
        MarkerLayer(markers: markers),
        const RichAttributionWidget(
          attributions: [TextSourceAttribution('OpenStreetMap contributors')],
        ),
      ],
    );
  }

  /// Подгоняет масштаб под выбранную поездку или весь день — при смене
  /// выбора и один раз, когда догрузились все точки. Потом карту не трогаем:
  /// родитель мог сам её подвинуть.
  void _fitIfNeeded(
    TripDay day,
    DayTrip? selected,
    Map<String, TrackData?> tracks,
    Size size,
  ) {
    if (!_mapReady) return;
    final scopeTrips = selected != null ? [selected] : day.trips;
    final scope = '${day.key}|${selected?.trip.id ?? ''}';
    final complete = scopeTrips.every((t) => tracks[t.trip.id] != null);
    if (scope == _fittedScope && (_fittedComplete || !complete)) return;
    _fittedScope = scope;
    _fittedComplete = complete;

    final pts = <LatLng>[];
    for (final t in scopeTrips) {
      pts
        ..add(LatLng(t.trip.startLat, t.trip.startLon))
        ..add(LatLng(t.trip.endLat, t.trip.endLon));
      for (final p in tracks[t.trip.id]?.points ?? const <ChildLocation>[]) {
        pts.add(LatLng(p.lat, p.lon));
      }
    }
    final sheet = _sheet.isAttached ? _sheet.size : _kSheetMid;
    // Сверху — плашка выбранной поездки, снизу — шторка.
    final padding = EdgeInsets.fromLTRB(
      32,
      selected != null ? 200 : 32,
      32,
      math.min(sheet, _kSheetMid) * size.height + 24,
    );
    final bounds = LatLngBounds.fromPoints(pts);
    if (bounds.north - bounds.south < 1e-4 && bounds.east - bounds.west < 1e-4) {
      _map.move(bounds.center, 16);
      return;
    }
    _map.fitCamera(CameraFit.bounds(bounds: bounds, padding: padding, maxZoom: 17));
  }
}

class _StartRing extends StatelessWidget {
  const _StartRing({required this.color, required this.dim});

  final Color color;
  final bool dim;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: dim ? 0.45 : 1,
      child: Container(
        width: 14,
        height: 14,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: color, width: 3),
          boxShadow: const [BoxShadow(color: Color(0x59000000), blurRadius: 3)],
        ),
      ),
    );
  }
}

class _FinishBadge extends StatelessWidget {
  const _FinishBadge({
    required this.color,
    required this.ordinal,
    required this.dim,
    required this.selected,
  });

  final Color color;
  final int ordinal;
  final bool dim;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final size = selected ? 28.0 : 24.0;
    return Opacity(
      opacity: dim ? 0.45 : 1,
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 4)],
        ),
        child: Text(
          '$ordinal',
          style: TextStyle(
            color: Colors.white,
            fontSize: selected ? 13 : 11,
            fontWeight: FontWeight.w700,
            fontFeatures: _tabular,
          ),
        ),
      ),
    );
  }
}

/// Шторка со списком дней. Один ListView — требование DraggableScrollableSheet.
class _DaysSheet extends StatelessWidget {
  const _DaysSheet({
    required this.scroll,
    required this.days,
    required this.activeKey,
    required this.selectedId,
    required this.zones,
    required this.now,
    required this.onPickDay,
    required this.onPickTrip,
  });

  final ScrollController scroll;
  final List<TripDay> days;
  final String activeKey;
  final String? selectedId;
  final List<Zone>? zones;
  final DateTime now;
  final void Function(String key) onPickDay;
  final void Function(TripDay day, String tripId) onPickTrip;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: ListView.builder(
        controller: scroll,
        padding: EdgeInsets.only(bottom: MediaQuery.paddingOf(context).bottom + 16),
        itemCount: days.length + 1,
        itemBuilder: (context, i) {
          if (i == 0) {
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
            );
          }
          final day = days[i - 1];
          final active = day.key == activeKey;
          return _DaySection(
            day: day,
            active: active,
            selectedId: active ? selectedId : null,
            zones: zones,
            now: now,
            onPickDay: () => onPickDay(day.key),
            onPickTrip: (id) => onPickTrip(day, id),
          );
        },
      ),
    );
  }
}

class _DaySection extends StatelessWidget {
  const _DaySection({
    required this.day,
    required this.active,
    required this.selectedId,
    required this.zones,
    required this.now,
    required this.onPickDay,
    required this.onPickTrip,
  });

  final TripDay day;
  final bool active;
  final String? selectedId;
  final List<Zone>? zones;
  final DateTime now;
  final VoidCallback onPickDay;
  final void Function(String tripId) onPickTrip;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final t = dayTitle(day.date, now);
    final n = day.trips.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          color: active ? theme.colorScheme.surfaceContainerHighest : Colors.transparent,
          child: InkWell(
            onTap: onPickDay,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        t.title,
                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(width: 8),
                      Text(t.date, style: theme.textTheme.bodySmall?.copyWith(color: muted)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '$n ${pluralRu(n, 'поездка', 'поездки', 'поездок')} · '
                          '${fmtDistance(day.distanceM)} · ${fmtDuration(day.moving)}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.end,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: muted,
                            fontFeatures: _tabular,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  _DayRibbon(day: day, selectedId: selectedId, now: now, onPickTrip: onPickTrip),
                ],
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < day.trips.length; i++) ...[
                _TripRow(
                  item: day.trips[i],
                  selected: day.trips[i].trip.id == selectedId,
                  zones: zones,
                  now: now,
                  onTap: () => onPickTrip(day.trips[i].trip.id),
                ),
                if (i + 1 < day.trips.length && day.trips[i].trip.endedAt != null)
                  _StayGap(
                    from: day.trips[i].trip.endedAt!,
                    to: day.trips[i + 1].trip.startedAt,
                  ),
              ],
            ],
          ),
        ),
        const Divider(height: 1),
      ],
    );
  }
}

/// Лента суток 0–24 ч: когда ребёнок был в пути.
class _DayRibbon extends StatelessWidget {
  const _DayRibbon({
    required this.day,
    required this.selectedId,
    required this.now,
    required this.onPickTrip,
  });

  final TripDay day;
  final String? selectedId;
  final DateTime now;
  final void Function(String tripId) onPickTrip;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final nowFrac = now.difference(day.date).inMinutes / (24 * 60);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, box) {
            final w = box.maxWidth;
            return SizedBox(
              height: 24,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned.fill(
                    top: 2,
                    bottom: 2,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(6),
                      ),
                    ),
                  ),
                  for (final h in const [6, 12, 18])
                    Positioned(
                      left: w * h / 24,
                      top: 6,
                      bottom: 6,
                      child: Container(width: 1, color: theme.colorScheme.outlineVariant),
                    ),
                  if (nowFrac > 0 && nowFrac < 1)
                    Positioned(
                      left: w * nowFrac - 1,
                      top: 0,
                      bottom: 0,
                      child: Container(
                        width: 2,
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                      ),
                    ),
                  for (final item in day.trips) _segment(item, w),
                ],
              ),
            );
          },
        ),
        const SizedBox(height: 2),
        DefaultTextStyle.merge(
          style: theme.textTheme.labelSmall?.copyWith(color: muted, fontSize: 10),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [Text('0'), Text('6'), Text('12'), Text('18'), Text('24')],
          ),
        ),
      ],
    );
  }

  Widget _segment(DayTrip item, double w) {
    final span = ribbonSpan(item.trip, day.date, now);
    final isSel = item.trip.id == selectedId;
    final dim = selectedId != null && !isSel;
    final width = math.max(4.0, w * span.width);
    return Positioned(
      left: math.min(w * span.left, w - width),
      width: width,
      top: isSel ? 0 : 5,
      bottom: isSel ? 0 : 5,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => onPickTrip(item.trip.id),
        child: Container(
          decoration: BoxDecoration(
            color: dim ? item.color.withValues(alpha: 0.35) : item.color,
            borderRadius: BorderRadius.circular(3),
          ),
        ),
      ),
    );
  }
}

class _TripRow extends StatefulWidget {
  const _TripRow({
    required this.item,
    required this.selected,
    required this.zones,
    required this.now,
    required this.onTap,
  });

  final DayTrip item;
  final bool selected;
  final List<Zone>? zones;
  final DateTime now;
  final VoidCallback onTap;

  @override
  State<_TripRow> createState() => _TripRowState();
}

class _TripRowState extends State<_TripRow> {
  @override
  void initState() {
    super.initState();
    if (widget.selected) _revealSoon();
  }

  @override
  void didUpdateWidget(_TripRow old) {
    super.didUpdateWidget(old);
    if (widget.selected && !old.selected) _revealSoon();
  }

  /// Выбор с карты или ленты — докручиваем шторку до строки. С паузой: сначала
  /// шторка доезжает до средней высоты (_pickTrip), потом считаем видимость.
  void _revealSoon() {
    Future.delayed(const Duration(milliseconds: 300), () {
      if (!mounted) return;
      Scrollable.ensureVisible(
        context,
        alignment: 0.1,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final selected = widget.selected;
    final zones = widget.zones;
    final now = widget.now;
    final onTap = widget.onTap;
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final trip = item.trip;
    final duration = tripDuration(trip, now);
    final speed = avgSpeedKmh(trip.distanceM, duration);
    final end = trip.endedAt;

    return Material(
      color: selected ? theme.colorScheme.surfaceContainerHigh : Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          decoration: selected
              ? BoxDecoration(border: Border(left: BorderSide(color: item.color, width: 3)))
              : null,
          padding: const EdgeInsets.fromLTRB(8, 10, 8, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 24,
                height: 24,
                margin: const EdgeInsets.only(top: 1),
                alignment: Alignment.center,
                decoration: BoxDecoration(color: item.color, shape: BoxShape.circle),
                child: Text(
                  '${item.ordinal}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    fontFeatures: _tabular,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${fmtClock(trip.startedAt)} – ${end != null ? fmtClock(end) : 'сейчас'}',
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w700,
                              fontFeatures: _tabular,
                            ),
                          ),
                        ),
                        if (trip.isActive)
                          const _InProgressBadge()
                        else
                          Text(
                            fmtDuration(duration),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: muted,
                              fontFeatures: _tabular,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Flexible(child: _Place(lat: trip.startLat, lon: trip.startLon, zones: zones)),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          child: Icon(Icons.arrow_forward, size: 14, color: muted),
                        ),
                        Flexible(child: _Place(lat: trip.endLat, lon: trip.endLon, zones: zones)),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      speed != null
                          ? '${fmtDistance(trip.distanceM)} · $speed км/ч в среднем'
                          : fmtDistance(trip.distanceM),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: muted,
                        fontFeatures: _tabular,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InProgressBadge extends StatelessWidget {
  const _InProgressBadge();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fg = dark ? const Color(0xFF6EE7B7) : const Color(0xFF047857);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFF10B981).withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: const BoxDecoration(color: Color(0xFF10B981), shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            'В пути',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
          ),
        ],
      ),
    );
  }
}

/// Между поездками — сколько ребёнок пробыл на месте.
class _StayGap extends StatelessWidget {
  const _StayGap({required this.from, required this.to});

  final DateTime from;
  final DateTime to;

  @override
  Widget build(BuildContext context) {
    final d = to.difference(from);
    if (d.inMinutes < 1) return const SizedBox(height: 4);
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(left: 19),
      child: Row(
        children: [
          Container(width: 1.5, height: 18, color: theme.colorScheme.outlineVariant),
          const SizedBox(width: 18),
          Text(
            '${fmtDuration(d)} на месте',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// Подпись места: геозона ребёнка, иначе адрес ближайшего дома.
class _Place extends ConsumerWidget {
  const _Place({required this.lat, required this.lon, required this.zones});

  final double lat;
  final double lon;

  /// null — зоны ещё грузятся: адрес не запрашиваем.
  final List<Zone>? zones;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final style = theme.textTheme.bodyMedium;
    final zs = zones;
    final zone = zs == null ? null : zoneAt(zs, lat, lon);
    if (zone != null) {
      final color = parseZoneColor(zone.color);
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(zoneIconData(zone.icon), size: 15, color: color),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              zone.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: style?.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      );
    }
    final placeholder = Container(
      width: 88,
      height: 12,
      decoration: BoxDecoration(
        color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(4),
      ),
    );
    if (zs == null) return placeholder;
    final addr = ref.watch(reversePlaceProvider(reverseKey(lat, lon)));
    return addr.when(
      loading: () => placeholder,
      data: (name) => Text(
        name ?? 'точка на карте',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: name != null ? style : style?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      ),
      error: (_, _) => Text(
        'точка на карте',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: style?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      ),
    );
  }
}

/// Плашка над картой: подробности выбранной поездки.
class _SelectedTripCard extends StatelessWidget {
  const _SelectedTripCard({
    required this.item,
    required this.day,
    required this.track,
    required this.zones,
    required this.now,
    required this.onClear,
  });

  final DayTrip item;
  final TripDay day;
  final TrackData? track;
  final List<Zone>? zones;
  final DateTime now;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final trip = item.trip;
    final duration = tripDuration(trip, now);
    final speed = avgSpeedKmh(trip.distanceM, duration);
    final stays = track?.stays.length ?? 0;
    final end = trip.endedAt;

    Widget place(String time, double lat, double lon) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            children: [
              SizedBox(
                width: 52,
                child: Text(
                  time,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: muted,
                    fontFeatures: _tabular,
                  ),
                ),
              ),
              Flexible(child: _Place(lat: lat, lon: lon, zones: zones)),
            ],
          ),
        );

    return Material(
      elevation: 4,
      borderRadius: BorderRadius.circular(14),
      color: theme.colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 6, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(color: item.color, shape: BoxShape.circle),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Поездка ${item.ordinal} · ${dayTitle(day.date, now).title.toLowerCase()}',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                TextButton.icon(
                  onPressed: onClear,
                  iconAlignment: IconAlignment.end,
                  icon: const Icon(Icons.close, size: 16),
                  label: const Text('Весь день'),
                ),
              ],
            ),
            place(fmtClock(trip.startedAt), trip.startLat, trip.startLon),
            place(end != null ? fmtClock(end) : 'сейчас', trip.endLat, trip.endLon),
            const Padding(
              padding: EdgeInsets.only(top: 8, bottom: 8, right: 8),
              child: Divider(height: 1),
            ),
            Row(
              children: [
                _Stat(value: fmtDuration(duration), label: 'в пути'),
                _Stat(value: fmtDistance(trip.distanceM), label: 'путь'),
                _Stat(value: speed != null ? '$speed км/ч' : '—', label: 'ср. скорость'),
              ],
            ),
            if (stays > 0) ...[
              const SizedBox(height: 6),
              Text(
                '$stays ${pluralRu(stays, 'остановка', 'остановки', 'остановок')} '
                'в пути — отмечены «П» на карте',
                style: theme.textTheme.bodySmall?.copyWith(color: muted),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w700,
              fontFeatures: _tabular,
            ),
          ),
          Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
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
            Icon(Icons.timeline_outlined, size: 48, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 16),
            Text(
              'За последние 30 дней поездок нет',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Поездка появится здесь, когда ребёнок начнёт двигаться и отойдёт '
              'от места, где был.',
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
            Icon(Icons.error_outline, size: 48, color: Theme.of(context).colorScheme.error),
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
            FilledButton.tonal(onPressed: onRetry, child: const Text('Повторить')),
          ],
        ),
      ),
    );
  }
}
