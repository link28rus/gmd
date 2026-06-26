import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../children/child_models.dart';
import '../children/children_providers.dart';
import 'widgets/child_action_sheet.dart';

/// Экран ребёнка: OSM-карта (flutter_map) + последняя локация + активный
/// трек + collapsible bottom-sheet с действиями.
///
/// v0.50.0 редизайн: 4-плиточный horizontal `_BottomPanel` заменён на
/// `DraggableScrollableSheet` с always-visible `ChildStatusCard` (имя +
/// 4 метрики: батарея/точность/связь/источник) и развернутым списком из
/// 7 ListTile-action'ов. См. план в
/// `docs/engineering/plans/2026-04-29-child-detail-redesign.md`.
class ChildDetailScreen extends ConsumerStatefulWidget {
  const ChildDetailScreen({super.key, required this.childId});

  final String childId;

  @override
  ConsumerState<ChildDetailScreen> createState() => _ChildDetailScreenState();
}

class _ChildDetailScreenState extends ConsumerState<ChildDetailScreen> {
  final MapController _map = MapController();
  bool _firstFitDone = false;
  bool _mapReady = false;
  // Версия для пересоздания TileLayer после onMapReady — workaround
  // для flutter_map 7.0.2: первый mount не триггерит fetch tiles до user-event.
  int _tileGen = 0;

  @override
  Widget build(BuildContext context) {
    final childrenAsync = ref.watch(childrenListProvider);
    final latestAsync = ref.watch(childLatestLocationProvider(widget.childId));
    final trackAsync = ref.watch(childActiveTrackProvider(widget.childId));

    final child = childrenAsync.maybeWhen(
      data: (list) => list.firstWhere(
        (c) => c.id == widget.childId,
        orElse: () => Child(id: widget.childId, name: 'Ребёнок'),
      ),
      orElse: () => Child(id: widget.childId, name: 'Ребёнок'),
    );

    final latest = latestAsync.value;
    final track = trackAsync.value ?? const <ChildLocation>[];

    // После того, как данные пришли — один раз центрируем карту. Ждём
    // пока сама карта будет готова (см. onMapReady) — иначе fitCamera
    // на «пустых» границах не сработает корректно.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_firstFitDone && _mapReady && mounted) _maybeFit(latest, track);
    });

    return Scaffold(
      appBar: AppBar(
        title: Text(child.name),
        actions: [
          IconButton(
            tooltip: 'Обновить',
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(childLatestLocationProvider(widget.childId));
              ref.invalidate(childActiveTrackProvider(widget.childId));
              setState(() => _firstFitDone = false);
            },
          ),
        ],
      ),
      // Stack чтобы DraggableScrollableSheet ехал поверх карты, а не
      // отъедал у неё высоту как в Column. SafeArea тут не нужен — карта
      // должна занимать всё доступное пространство, sheet сам учитывает
      // системную нижнюю панель через MediaQuery.padding.
      body: Stack(
        children: [
          // ─── Карта на весь экран ────────────────────────────────────
          Positioned.fill(
            child: (latest == null && latestAsync.isLoading)
                ? const Center(child: CircularProgressIndicator())
                : Stack(
                    // StackFit.expand ОБЯЗАТЕЛЕН: иначе non-positioned FlutterMap
                    // получает loose constraints и может стартовать с size=0 →
                    // TileLayer не запрашивает тайлы до user-event (карта серая).
                    // См. https://docs.fleaflet.dev/usage/basics
                    fit: StackFit.expand,
                    children: [
                      FlutterMap(
                        mapController: _map,
                        options: MapOptions(
                          initialCenter: latest != null
                              ? LatLng(latest.lat, latest.lon)
                              : const LatLng(55.7558, 37.6173), // Москва, дефолт
                          initialZoom: latest != null ? 15 : 10,
                          minZoom: 3,
                          maxZoom: 18,
                          interactionOptions: const InteractionOptions(
                            flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
                          ),
                          onMapReady: () {
                            if (!mounted) return;
                            setState(() {
                              _mapReady = true;
                              _tileGen++; // форсим пересоздание TileLayer
                            });
                            _maybeFit(latest, track);
                          },
                        ),
                        children: [
                          // OSM tile-сервер. Соблюдаем Tile Usage Policy:
                          // userAgentPackageName идентифицирует наш проект.
                          // https://operations.osmfoundation.org/policies/tiles/
                          TileLayer(
                            key: ValueKey('tile_$_tileGen'),
                            urlTemplate:
                                'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                            userAgentPackageName: 'pro.periscop.parent',
                            maxNativeZoom: 19,
                            keepBuffer: 4,
                            panBuffer: 2,
                          ),
                          if (track.length >= 2)
                            PolylineLayer(
                              polylines: [
                                Polyline(
                                  points: track
                                      .map((p) => LatLng(p.lat, p.lon))
                                      .toList(),
                                  strokeWidth: 4,
                                  color: const Color(0xFF2E7D32),
                                  borderStrokeWidth: 1,
                                  borderColor: Colors.white,
                                ),
                              ],
                            ),
                          if (latest != null)
                            MarkerLayer(
                              markers: [
                                Marker(
                                  point: LatLng(latest.lat, latest.lon),
                                  width: 56,
                                  height: 56,
                                  alignment: Alignment.topCenter,
                                  child: _ChildMarker(letter: _firstLetter(child.name)),
                                ),
                              ],
                            ),
                          const RichAttributionWidget(
                            // Атрибуция OSM обязательна по лицензии ODbL.
                            attributions: [
                              TextSourceAttribution('OpenStreetMap contributors'),
                            ],
                          ),
                        ],
                      ),
                      if (latestAsync.isLoading)
                        const Positioned(
                          top: 12,
                          left: 12,
                          child: Card(
                            child: Padding(
                              padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  ),
                                  SizedBox(width: 8),
                                  Text('Загружаем точку…'),
                                ],
                              ),
                            ),
                          ),
                        ),
                      if (latestAsync.hasError)
                        Positioned(
                          top: 12,
                          left: 12,
                          right: 12,
                          child: Card(
                            color: Colors.red.shade50,
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Text(
                                'Не удалось загрузить локацию: ${latestAsync.error}',
                                style: TextStyle(color: Colors.red.shade800),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
          // ─── FAB «к ребёнку» — над картой, но над sheet'ом ─────────
          // Позиционируем выше collapsed sheet'а, чтобы кнопка не
          // пряталась под ним.
          Positioned(
            right: 16,
            bottom: MediaQuery.of(context).size.height * 0.18 + 12,
            child: FloatingActionButton.small(
              heroTag: 'follow_${widget.childId}',
              tooltip: 'К ребёнку',
              onPressed: () => _focusOnChild(latest),
              child: const Icon(Icons.my_location),
            ),
          ),
          // ─── Bottom-sheet ──────────────────────────────────────────
          // initial / min = 0.18 → видна компактная status-card (имя +
          // «Был тут N назад» + одна строка inline-метрик: 🔋80% · 🎯±4м
          // · 📶MegaFon). Учитывает Android system nav bar (~0.05 на
          // 3-button MIUI/HyperOS) — без 0.18 inline-метрики подрезались.
          // max = 0.7 → раскрытый список 7 ListTile-actions.
          // snap=true со snapSizes даёт два «защёлкнутых» состояния.
          DraggableScrollableSheet(
            initialChildSize: 0.18,
            minChildSize: 0.18,
            maxChildSize: 0.7,
            snap: true,
            snapSizes: const [0.18, 0.7],
            builder: (context, scrollController) => ChildActionSheet(
              child: child,
              latest: latest,
              scrollController: scrollController,
            ),
          ),
        ],
      ),
    );
  }

  void _focusOnChild(ChildLocation? latest) {
    if (latest == null) return;
    _map.move(LatLng(latest.lat, latest.lon), 16);
  }

  void _maybeFit(ChildLocation? latest, List<ChildLocation> track) {
    if (_firstFitDone) return;
    if (track.length >= 2) {
      final lats = track.map((p) => p.lat);
      final lons = track.map((p) => p.lon);
      final south = lats.reduce((a, b) => a < b ? a : b);
      final north = lats.reduce((a, b) => a > b ? a : b);
      final west = lons.reduce((a, b) => a < b ? a : b);
      final east = lons.reduce((a, b) => a > b ? a : b);
      _map.fitCamera(
        CameraFit.bounds(
          bounds: LatLngBounds(LatLng(south, west), LatLng(north, east)),
          padding: const EdgeInsets.all(48),
        ),
      );
      _firstFitDone = true;
    } else if (latest != null) {
      _focusOnChild(latest);
      _firstFitDone = true;
    }
  }
}

String _firstLetter(String name) {
  final t = name.trim();
  if (t.isEmpty) return '?';
  return t.characters.first.toUpperCase();
}

class _ChildMarker extends StatelessWidget {
  const _ChildMarker({required this.letter});

  final String letter;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: const Color(0xFF2E7D32),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.25),
                blurRadius: 4,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          alignment: Alignment.center,
          child: Text(
            letter,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 16,
            ),
          ),
        ),
        // Маленький треугольник-указатель, чтобы было понятно, какая точно точка.
        CustomPaint(
          size: const Size(12, 8),
          painter: _ArrowPainter(),
        ),
      ],
    );
  }
}

class _ArrowPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final path = ui.Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = const Color(0xFF2E7D32));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
