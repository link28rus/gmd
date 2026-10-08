import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/diag/diag_channel.dart';
import '../../core/providers.dart';
import '../children/child_models.dart';
import '../zones/widgets/where_am_i.dart';
import '../zones/widgets/zone_widgets.dart';
import '../zones/zone_map_view.dart';
import '../zones/zone_models.dart';
import '../zones/zones_providers.dart';

/// Общая карта семьи (v0.70.0): OSM-тайлы, круги и значки геозон, метки
/// детей (давность точки, круг точности, серая метка у старой точки), метки
/// родителей, кнопки «Где я» и «Показать всё».
///
/// Используется на главном экране (только просмотр, нажатие на ребёнка —
/// экран ребёнка) и на экране геозон (выбор зоны, меню у метки ребёнка).
/// Обновлением данных карта не занимается — их передаёт экран.

/// Цвет меток родителей — отличается от зелёных меток детей.
const kParentMarkerColor = Color(0xFF1E88E5);

const _kKidAccuracyColor = Color(0xFF2E7D32);

/// Управление камерой снаружи (экран геозон: фокус на зоне/ребёнке, центр
/// новой зоны). Методы безопасно звать до готовности карты — ничего не будет.
class FamilyMapController {
  final MapController _map = MapController();
  bool _ready = false;
  MapCamera? _camera;
  LatLng? _initialCenter;

  bool get isReady => _ready;

  /// Последнее положение камеры (null — карта ещё не двигалась).
  MapCamera? get camera => _camera;

  /// Стартовый центр (null — ещё не определён).
  LatLng? get initialCenter => _initialCenter;

  void move(LatLng point, double zoom) {
    if (_ready) _map.move(point, zoom);
  }
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

/// Круг точности точки (радиус в метрах). null — точность неизвестна.
CircleMarker? accuracyCircle(double lat, double lon, double? accuracy, Color color) {
  if (accuracy == null || !accuracy.isFinite || accuracy <= 0) return null;
  return CircleMarker(
    point: LatLng(lat, lon),
    radius: accuracy,
    useRadiusInMeter: true,
    color: color.withValues(alpha: 0.12),
    borderColor: color.withValues(alpha: 0.45),
    borderStrokeWidth: 1,
  );
}

class FamilyMap extends ConsumerStatefulWidget {
  const FamilyMap({
    super.key,
    required this.controller,
    required this.zones,
    required this.points,
    required this.kidById,
    required this.dataReady,
    this.parents = const [],
    this.selectedZoneId,
    this.onZoneTap,
    this.onKidTap,
    this.heroTagPrefix = 'map',
    this.fitAllTooltip = 'Показать всех',
  });

  final FamilyMapController controller;
  final List<Zone> zones;

  /// Последние точки детей.
  final List<FamilyLatestPoint> points;
  final Map<String, Child> kidById;

  /// Зоны и точки ответили (или упали) — можно выбирать стартовый вид.
  final bool dataReady;

  /// Метки родителей (на карте геозон не показываются — не передаются).
  final List<FamilyLatestParent> parents;

  final String? selectedZoneId;
  final void Function(Zone zone)? onZoneTap;
  final void Function(Child kid, FamilyLatestPoint point)? onKidTap;

  /// Префикс heroTag у кнопок — карта бывает на двух экранах в одном стеке.
  final String heroTagPrefix;
  final String fitAllTooltip;

  @override
  ConsumerState<FamilyMap> createState() => _FamilyMapState();
}

class _FamilyMapState extends ConsumerState<FamilyMap> {
  // Пересоздание TileLayer после onMapReady — workaround flutter_map 7.0.2:
  // первый mount не запрашивает тайлы до user-event (см. child_detail_screen).
  int _tileGen = 0;

  _InitialView? _view;
  bool _resolving = false;
  LatLng? _me;
  Timer? _saveTimer;
  String? _userId;

  FamilyMapController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    _userId = ref.read(authSessionProvider)?.user.id;
  }

  @override
  void dispose() {
    _saveTimer?.cancel();
    final cam = _c._camera;
    if (cam != null) {
      unawaited(
        writeSavedMapView(
          _userId,
          SavedMapView(cam.center.latitude, cam.center.longitude, cam.zoom),
        ),
      );
    }
    _c._ready = false;
    super.dispose();
  }

  List<LatLng> _pointsInFrame({LatLng? me}) => framePoints(widget.zones, [
    ...widget.points.map((p) => LatLng(p.lat, p.lon)),
    ...widget.parents.map((p) => LatLng(p.lat, p.lon)),
    ?me,
  ]);

  // ─── Центр карты: зоны и точки → последний вид → IP → Москва ─────────────
  Future<void> _resolveView() async {
    final pts = _pointsInFrame();
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
    if (!mounted) return;
    _c._initialCenter = view.center;
    setState(() => _view = view);
  }

  void _onPositionChanged(MapCamera camera, bool hasGesture) {
    _c._camera = camera;
    if (!hasGesture) return;
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 800), () {
      unawaited(
        writeSavedMapView(
          _userId,
          SavedMapView(camera.center.latitude, camera.center.longitude, camera.zoom),
        ),
      );
    });
  }

  void _fitAll() {
    if (!_c._ready) return;
    final pts = _pointsInFrame(me: _me);
    if (pts.length >= 2) {
      _c._map.fitCamera(
        CameraFit.coordinates(coordinates: pts, padding: const EdgeInsets.all(48), maxZoom: 16),
      );
    } else if (pts.length == 1) {
      _c._map.move(pts.first, 15);
    }
  }

  Future<void> _whereAmI() async {
    final me = await locateMe(context);
    if (me == null || !mounted) return;
    setState(() => _me = me);
    if (_c._ready) _c._map.move(me, math.max(_c._camera?.zoom ?? 15, 15));
  }

  @override
  Widget build(BuildContext context) {
    if (_view == null && !_resolving && widget.dataReady) {
      _resolving = true;
      unawaited(_resolveView());
    }
    final view = _view;
    if (view == null) return const Center(child: CircularProgressIndicator());

    final scheme = Theme.of(context).colorScheme;
    final kids = [
      for (final p in widget.points)
        if (widget.kidById[p.childId] != null) (kid: widget.kidById[p.childId]!, point: p),
    ];
    final onKidTap = widget.onKidTap;

    return Stack(
      // StackFit.expand ОБЯЗАТЕЛЕН: иначе FlutterMap может стартовать с size=0
      // и не запросить тайлы (карта серая).
      fit: StackFit.expand,
      children: [
        FlutterMap(
          mapController: _c._map,
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
              _c._ready = true;
              setState(() => _tileGen++);
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
            CircleLayer(circles: zoneCircles(widget.zones, selectedId: widget.selectedZoneId)),
            MarkerLayer(markers: zoneCenterMarkers(widget.zones, onTap: widget.onZoneTap)),
            CircleLayer(
              circles: [
                for (final p in widget.parents)
                  ?accuracyCircle(p.lat, p.lon, p.accuracy, kParentMarkerColor),
                for (final k in kids)
                  ?accuracyCircle(k.point.lat, k.point.lon, k.point.accuracy, _kKidAccuracyColor),
              ],
            ),
            MarkerLayer(
              markers: [
                // Родители — под детьми: дети главнее.
                for (final p in widget.parents)
                  Marker(
                    point: LatLng(p.lat, p.lon),
                    width: ParentMapMarker.width,
                    height: ParentMapMarker.height,
                    alignment: Alignment.topCenter,
                    child: ParentMapMarker(parent: p),
                  ),
                for (final k in kids)
                  Marker(
                    point: LatLng(k.point.lat, k.point.lon),
                    width: KidMapMarker.width,
                    height: KidMapMarker.height,
                    alignment: Alignment.topCenter,
                    child: KidMapMarker(
                      child: k.kid,
                      ageSec: k.point.ageSec,
                      onTap: onKidTap == null ? null : () => onKidTap(k.kid, k.point),
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
                heroTag: '${widget.heroTagPrefix}_where_am_i',
                tooltip: 'Где я',
                onPressed: _whereAmI,
                child: const Icon(Icons.my_location),
              ),
              const SizedBox(height: 8),
              FloatingActionButton.small(
                heroTag: '${widget.heroTagPrefix}_fit_all',
                tooltip: widget.fitAllTooltip,
                onPressed: _fitAll,
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
}

/// Метка родителя: синий скруглённый квадрат с силуэтом, подпись — имя или
/// «Вы», давность точки; старая точка — серая.
class ParentMapMarker extends StatelessWidget {
  const ParentMapMarker({super.key, required this.parent});

  final FamilyLatestParent parent;

  static const width = 96.0;
  static const height = 72.0;

  @override
  Widget build(BuildContext context) {
    final stale = parent.ageSec > kStalePointSec;
    final title = parent.isMe ? 'Вы' : (parent.name.trim().isEmpty ? 'Родитель' : parent.name);
    final color = stale ? kStaleMarkerBorder : kParentMarkerColor;
    return MediaQuery.withClampedTextScaling(
      maxScaleFactor: 1.1,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          MapMarkerLabel(title: title, ageSec: parent.ageSec),
          const SizedBox(height: 2),
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.white, width: 2.5),
              boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 3)],
            ),
            alignment: Alignment.center,
            child: Icon(
              parent.isMe ? Icons.person_pin : Icons.person,
              size: 17,
              color: Colors.white,
            ),
          ),
        ],
      ),
    );
  }
}
