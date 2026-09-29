import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../core/diag/diag_channel.dart';
import '../../core/providers.dart';
import '../children/child_models.dart';
import '../children/children_providers.dart';
import 'widgets/where_am_i.dart';
import 'widgets/zone_places.dart';
import 'widgets/zone_widgets.dart';
import 'zone_format.dart';
import 'zone_map_view.dart';
import 'zone_models.dart';
import 'zones_providers.dart';

/// Геозоны (спека 3.1): карта с кругами зон и детьми, «кто сейчас внутри»,
/// значки расписания и срока, «Мои уведомления», создание и правка.
class ZonesScreen extends ConsumerStatefulWidget {
  const ZonesScreen({super.key});

  @override
  ConsumerState<ZonesScreen> createState() => _ZonesScreenState();
}

/// Стартовый вид карты — результат цепочки центра.
class _InitialView {
  const _InitialView({required this.center, required this.zoom, this.fit, this.ipAttribution});
  final LatLng center;
  final double zoom;
  final CameraFit? fit;

  /// Центр взят по IP — подпись DB-IP (CC BY 4.0).
  final String? ipAttribution;
}

class _ZonesScreenState extends ConsumerState<ZonesScreen> {
  final MapController _map = MapController();
  // Пересоздание TileLayer после onMapReady — workaround flutter_map 7.0.2:
  // первый mount не запрашивает тайлы до user-event (см. child_detail_screen).
  int _tileGen = 0;
  bool _mapReady = false;

  _InitialView? _view;
  bool _resolving = false;
  String? _selectedId;
  LatLng? _me;
  MapCamera? _lastCamera;
  Timer? _saveTimer;
  String? _userId;

  @override
  void initState() {
    super.initState();
    _userId = ref.read(authSessionProvider)?.user.id;
  }

  @override
  void dispose() {
    _saveTimer?.cancel();
    final cam = _lastCamera;
    if (cam != null) {
      unawaited(writeSavedMapView(
        _userId,
        SavedMapView(cam.center.latitude, cam.center.longitude, cam.zoom),
      ));
    }
    super.dispose();
  }

  // ─── Центр карты: зоны и дети → последний вид → IP → Москва ──────────────
  Future<void> _resolveView(List<Zone> zones, List<FamilyLatestPoint> points) async {
    final pts = framePoints(zones, points.map((p) => LatLng(p.lat, p.lon)));
    _InitialView view;
    if (pts.length >= 2) {
      view = _InitialView(
        center: pts.first,
        zoom: 14,
        fit: CameraFit.coordinates(
          coordinates: pts,
          padding: const EdgeInsets.all(48),
          maxZoom: 16,
        ),
      );
    } else if (pts.length == 1) {
      view = _InitialView(center: pts.first, zoom: 15);
    } else {
      SavedMapView? saved;
      try {
        saved = await readSavedMapView(_userId);
      } catch (e) {
        unawaited(diagLog('zones', 'saved map view failed: $e'));
      }
      if (!mounted) return;
      if (saved != null) {
        view = _InitialView(center: saved.center, zoom: saved.zoom);
      } else {
        IpCenter? ip;
        try {
          ip = await ref.read(zonesRepositoryProvider).ipCenter();
        } catch (e) {
          unawaited(diagLog('zones', 'ip-center failed: $e'));
        }
        view = ip != null
            ? _InitialView(
                center: LatLng(ip.lat, ip.lon),
                zoom: kIpCenterZoom,
                ipAttribution: ip.attribution,
              )
            : const _InitialView(center: kMoscow, zoom: kMoscowZoom);
      }
    }
    if (mounted) setState(() => _view = view);
  }

  void _onPositionChanged(MapCamera camera, bool hasGesture) {
    _lastCamera = camera;
    if (!hasGesture) return;
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 800), () {
      unawaited(writeSavedMapView(
        _userId,
        SavedMapView(camera.center.latitude, camera.center.longitude, camera.zoom),
      ));
    });
  }

  void _fitAll(List<Zone> zones, List<FamilyLatestPoint> points) {
    if (!_mapReady) return;
    final pts = framePoints(zones, [
      ...points.map((p) => LatLng(p.lat, p.lon)),
      ?_me,
    ]);
    if (pts.length >= 2) {
      _map.fitCamera(CameraFit.coordinates(
        coordinates: pts,
        padding: const EdgeInsets.all(48),
        maxZoom: 16,
      ));
    } else if (pts.length == 1) {
      _map.move(pts.first, 15);
    }
  }

  void _focusZone(Zone z) {
    if (!_mapReady) return;
    _map.move(LatLng(z.centerLat, z.centerLon), zoomForRadius(z.radius, z.centerLat));
  }

  Future<void> _whereAmI() async {
    final me = await locateMe(context);
    if (me == null || !mounted) return;
    setState(() => _me = me);
    if (_mapReady) _map.move(me, math.max(_lastCamera?.zoom ?? 15, 15));
  }

  void _createZone({LatLng? at, String? childId}) {
    final center = at ?? _lastCamera?.center ?? _view?.center ?? kMoscow;
    final zoom = at != null ? 16.0 : (_lastCamera?.zoom ?? 15);
    final q = <String, String>{
      'lat': center.latitude.toStringAsFixed(6),
      'lon': center.longitude.toStringAsFixed(6),
      'zoom': zoom.toStringAsFixed(1),
      'childId': ?childId,
    };
    context.push(Uri(path: '/home/zones/new', queryParameters: q).toString());
  }

  /// «Сохранить» у подсказки — редактор с её центром, названием, иконкой,
  /// цветом, радиусом и детьми.
  void _createFromSuggestion(PlaceSuggestion s) {
    final q = <String, String>{
      'lat': s.centerLat.toStringAsFixed(6),
      'lon': s.centerLon.toStringAsFixed(6),
      'zoom': '16',
      if (s.name.isNotEmpty) 'name': s.name,
      'icon': s.icon,
      'color': s.color,
      'radius': '${s.radius}',
      if (s.childIds.isNotEmpty) 'childIds': s.childIds.join(','),
    };
    context.push(Uri(path: '/home/zones/new', queryParameters: q).toString());
  }

  void _onKidTap(Child kid, FamilyLatestPoint point, bool canCreate) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(kid.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text('Точка ${formatAgeShort(point.ageSec)}'),
            ),
            ListTile(
              leading: const Icon(Icons.add_location_alt_outlined),
              title: const Text('Создать зону здесь'),
              subtitle: canCreate ? null : const Text('Достигнут лимит зон'),
              enabled: canCreate,
              onTap: () {
                Navigator.of(ctx).pop();
                _createZone(at: LatLng(point.lat, point.lon), childId: kid.id);
              },
            ),
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: const Text('Экран ребёнка'),
              onTap: () {
                Navigator.of(ctx).pop();
                context.push('/home/child/${kid.id}');
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _refresh() async {
    ref.invalidate(zonesListProvider);
    ref.invalidate(familyLatestProvider);
    ref.invalidate(childrenListProvider);
    ref.invalidate(zoneSuggestionsProvider);
    ref.invalidate(zoneStatsProvider);
    try {
      await ref.read(zonesListProvider.future);
    } catch (_) {
      // ошибку покажет сам список
    }
  }

  @override
  Widget build(BuildContext context) {
    final zonesAsync = ref.watch(zonesListProvider);
    final latestAsync = ref.watch(familyLatestProvider);
    final kids = ref.watch(childrenListProvider).valueOrNull ?? const <Child>[];

    final zones = zonesAsync.valueOrNull ?? const <Zone>[];
    final points = latestAsync.valueOrNull ?? const <FamilyLatestPoint>[];
    final kidById = {for (final k in kids) k.id: k};
    final kidNames = {for (final k in kids) k.id: k.name};
    final canCreate = zonesAsync.hasValue && zones.length < kMaxZones;

    // Цепочка центра стартует, когда и зоны, и точки ответили (или упали).
    final zonesDone = zonesAsync.hasValue || zonesAsync.hasError;
    final latestDone = latestAsync.hasValue || latestAsync.hasError;
    if (_view == null && !_resolving && zonesDone && latestDone) {
      _resolving = true;
      unawaited(_resolveView(zones, points));
    }

    final mapHeight = math.max(220.0, MediaQuery.of(context).size.height * 0.4);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Геозоны'),
        actions: [
          IconButton(
            tooltip: 'События',
            icon: const Icon(Icons.history),
            onPressed: () => context.push('/home/zones/events'),
          ),
          IconButton(
            tooltip: 'Обновить',
            icon: const Icon(Icons.refresh),
            onPressed: _refresh,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.add_location_alt_outlined),
        label: const Text('Новая зона'),
        onPressed: canCreate ? () => _createZone() : null,
        backgroundColor: canCreate ? null : Theme.of(context).disabledColor,
        tooltip: canCreate || !zonesAsync.hasValue ? null : 'Не больше $kMaxZones зон на семью',
      ),
      body: Column(
        children: [
          SizedBox(
            height: mapHeight,
            child: _view == null
                ? const Center(child: CircularProgressIndicator())
                : _buildMap(zones, points, kidById, canCreate),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                children: [
                  if (kids.isNotEmpty)
                    _KidsSection(
                      kids: kids,
                      zones: zones,
                      points: points,
                      latestLoading: latestAsync.isLoading && !latestAsync.hasValue,
                      latestError: latestAsync.hasError,
                      canCreate: canCreate,
                      onFocus: (p) {
                        if (_mapReady) _map.move(LatLng(p.lat, p.lon), 16);
                      },
                      onCreateAt: (kid, p) =>
                          _createZone(at: LatLng(p.lat, p.lon), childId: kid.id),
                    ),
                  const SizedBox(height: 12),
                  ZonePlaceSuggestions(
                    kidNames: kidNames,
                    canCreate: canCreate,
                    onSave: _createFromSuggestion,
                  ),
                  ..._buildZonesSection(context, zonesAsync, zones, kidNames),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMap(
    List<Zone> zones,
    List<FamilyLatestPoint> points,
    Map<String, Child> kidById,
    bool canCreate,
  ) {
    final view = _view!;
    final scheme = Theme.of(context).colorScheme;
    return Stack(
      // StackFit.expand ОБЯЗАТЕЛЕН: иначе FlutterMap может стартовать с size=0
      // и не запросить тайлы (карта серая).
      fit: StackFit.expand,
      children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: view.center,
            initialZoom: view.zoom,
            initialCameraFit: view.fit,
            minZoom: 3,
            maxZoom: 18,
            interactionOptions: const InteractionOptions(
              flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
            ),
            onPositionChanged: _onPositionChanged,
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
            CircleLayer(circles: zoneCircles(zones, selectedId: _selectedId)),
            MarkerLayer(
              markers: zoneCenterMarkers(
                zones,
                onTap: (z) => setState(() => _selectedId = z.id),
              ),
            ),
            MarkerLayer(
              markers: [
                for (final p in points)
                  if (kidById[p.childId] != null)
                    Marker(
                      point: LatLng(p.lat, p.lon),
                      width: KidMapMarker.width,
                      height: KidMapMarker.height,
                      alignment: Alignment.topCenter,
                      child: KidMapMarker(
                        child: kidById[p.childId]!,
                        onTap: () => _onKidTap(kidById[p.childId]!, p, canCreate),
                      ),
                    ),
                if (_me != null)
                  Marker(point: _me!, width: 18, height: 18, child: const MyLocationDot()),
              ],
            ),
            RichAttributionWidget(
              attributions: [
                const TextSourceAttribution('OpenStreetMap contributors'),
                if (view.ipAttribution != null)
                  TextSourceAttribution(view.ipAttribution!, prependCopyright: false),
              ],
            ),
          ],
        ),
        Positioned(
          right: 12,
          top: 12,
          child: Column(
            children: [
              FloatingActionButton.small(
                heroTag: 'zones_where_am_i',
                tooltip: 'Где я',
                onPressed: _whereAmI,
                child: const Icon(Icons.my_location),
              ),
              const SizedBox(height: 8),
              FloatingActionButton.small(
                heroTag: 'zones_fit_all',
                tooltip: 'Показать все зоны и детей',
                onPressed: () => _fitAll(zones, points),
                child: const Icon(Icons.zoom_out_map),
              ),
            ],
          ),
        ),
        if (view.ipAttribution != null)
          Positioned(
            left: 8,
            bottom: 8,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: scheme.surface.withValues(alpha: 0.85),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                'Центр по IP · ${view.ipAttribution}',
                style: TextStyle(fontSize: 10, color: scheme.onSurfaceVariant),
              ),
            ),
          ),
      ],
    );
  }

  List<Widget> _buildZonesSection(
    BuildContext context,
    AsyncValue<List<Zone>> zonesAsync,
    List<Zone> zones,
    Map<String, String> kidNames,
  ) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    if (zonesAsync.hasError && !zonesAsync.hasValue) {
      return [
        Card(
          color: scheme.errorContainer,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  zoneErrorMessage(zonesAsync.error!, ZoneAction.load),
                  style: TextStyle(color: scheme.onErrorContainer),
                ),
                const SizedBox(height: 8),
                FilledButton.tonal(onPressed: _refresh, child: const Text('Повторить')),
              ],
            ),
          ),
        ),
      ];
    }
    if (!zonesAsync.hasValue) {
      return const [
        Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    return [
      Text(
        'Зоны (${zones.length}/$kMaxZones)',
        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
      ),
      const SizedBox(height: 8),
      if (zones.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            children: [
              Text('У вас нет геозон.', style: theme.textTheme.bodyMedium),
              const SizedBox(height: 4),
              Text(
                'Создайте геозону, чтобы получать уведомления, когда ребёнок входит '
                'в неё или выходит.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        )
      else
        for (final z in zones)
          _ZoneCard(
            zone: z,
            kidNames: kidNames,
            selected: z.id == _selectedId,
            onTap: () {
              setState(() => _selectedId = _selectedId == z.id ? null : z.id);
              if (_selectedId == z.id) _focusZone(z);
            },
            onEdit: () => context.push('/home/zones/${z.id}/edit'),
            onEvents: () => context.push(
              Uri(path: '/home/zones/events', queryParameters: {'zoneId': z.id}).toString(),
            ),
            onDelete: () async {
              final deleted = await deleteZoneWithConfirm(context, ref, z);
              if (deleted && mounted) setState(() => _selectedId = null);
            },
          ),
    ];
  }
}

/// Блок «Дети»: где сейчас (по states зон), давность точки, «Зона здесь».
class _KidsSection extends StatelessWidget {
  const _KidsSection({
    required this.kids,
    required this.zones,
    required this.points,
    required this.latestLoading,
    required this.latestError,
    required this.canCreate,
    required this.onFocus,
    required this.onCreateAt,
  });

  final List<Child> kids;
  final List<Zone> zones;
  final List<FamilyLatestPoint> points;
  final bool latestLoading;
  final bool latestError;
  final bool canCreate;
  final ValueChanged<FamilyLatestPoint> onFocus;
  final void Function(Child kid, FamilyLatestPoint point) onCreateAt;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final pointByKid = {for (final p in points) p.childId: p};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Дети', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
        for (final kid in kids)
          Builder(builder: (_) {
            final point = pointByKid[kid.id];
            final inside = zones
                .where((z) => z.states.any((s) => s.childId == kid.id && s.isInside))
                .map((z) => z.name)
                .toList();
            final String where;
            if (inside.isNotEmpty) {
              where = 'в зоне «${inside.join('», «')}»';
            } else if (point != null) {
              where = 'вне зон';
            } else if (latestLoading) {
              where = 'загружаем…';
            } else if (latestError) {
              where = 'точки не загрузились';
            } else {
              where = 'нет данных о местоположении';
            }
            return ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text(kid.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(
                point != null ? '$where · ${formatAgeShort(point.ageSec)}' : where,
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
              onTap: point == null ? null : () => onFocus(point),
              trailing: point == null
                  ? null
                  : TextButton.icon(
                      icon: const Icon(Icons.add_location_alt_outlined, size: 18),
                      label: const Text('Зона здесь'),
                      onPressed: canCreate ? () => onCreateAt(kid, point) : null,
                    ),
            );
          }),
      ],
    );
  }
}

class _ZoneCard extends StatelessWidget {
  const _ZoneCard({
    required this.zone,
    required this.kidNames,
    required this.selected,
    required this.onTap,
    required this.onEdit,
    required this.onEvents,
    required this.onDelete,
  });

  final Zone zone;
  final Map<String, String> kidNames;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onEvents;
  final VoidCallback onDelete;

  String _assigned() {
    if (zone.allChildren) return 'Все дети';
    final names = zone.childIds.map((id) => kidNames[id]).whereType<String>().toList();
    return names.isNotEmpty ? names.join(', ') : 'Никто не назначен';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final color = parseZoneColor(zone.color);
    final inside = zone.insideChildIds.map((id) => kidNames[id]).whereType<String>().toList();

    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: selected ? color : scheme.outlineVariant, width: selected ? 2 : 1),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 14,
                    backgroundColor: color,
                    child: Icon(zoneIconData(zone.icon), size: 16, color: Colors.white),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      zone.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  Icon(selected ? Icons.expand_less : Icons.expand_more,
                      color: scheme.onSurfaceVariant),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Радиус ${formatRadius(zone.radius)} · ${_assigned()}',
                style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
              ZoneRuleBadges(zone: zone),
              if (inside.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text('Сейчас в зоне:',
                          style: theme.textTheme.bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant)),
                      for (final n in inside)
                        Chip(
                          label: Text(n),
                          visualDensity: VisualDensity.compact,
                          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          padding: EdgeInsets.zero,
                        ),
                    ],
                  ),
                ),
              if (selected) ...[
                const Divider(height: 20),
                MyZoneNotifications(zone: zone, kidNames: kidNames),
                const SizedBox(height: 8),
                ZoneStatsSection(zoneId: zone.id, kidNames: kidNames),
                const SizedBox(height: 4),
                Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 4,
                  children: [
                    TextButton.icon(
                      icon: const Icon(Icons.history, size: 18),
                      label: const Text('События'),
                      onPressed: onEvents,
                    ),
                    TextButton.icon(
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      label: const Text('Изменить'),
                      onPressed: onEdit,
                    ),
                    TextButton.icon(
                      icon: Icon(Icons.delete_outline, size: 18, color: scheme.error),
                      label: Text('Удалить', style: TextStyle(color: scheme.error)),
                      onPressed: onDelete,
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
