import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/push/live_location_push.dart';
import '../children/child_models.dart';
import '../children/children_providers.dart';
import '../children/widgets/child_avatar.dart';
import '../children/widgets/track_layers.dart';
import '../zones/widgets/zone_widgets.dart';
import '../zones/zones_providers.dart';
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

class _ChildDetailScreenState extends ConsumerState<ChildDetailScreen>
    with WidgetsBindingObserver {
  /// Как часто подтягивать свежую точку, пока экран открыт и приложение
  /// на переднем плане. v0.69.0: основной путь — тихий push о новой точке,
  /// опрос остаётся запасным и заодно продлевает отметку «смотрю» (90 с).
  static const _pollInterval = Duration(seconds: 30);

  final MapController _map = MapController();
  bool _firstFitDone = false;
  bool _mapReady = false;
  // Версия для пересоздания TileLayer после onMapReady — workaround
  // для flutter_map 7.0.2: первый mount не триггерит fetch tiles до user-event.
  int _tileGen = 0;

  Timer? _poll;
  StreamSubscription<String>? _pushSub;
  bool _refreshing = false;
  // Push пришёл, пока шёл запрос, — тот мог уйти до новой точки, повторяем.
  bool _refreshAgain = false;
  // Плашка «Загружаем точку…» — только на ручное обновление, фоновый
  // опрос раз в 30 с не должен мигать ею.
  bool _manualRefreshing = false;
  // Камера едет за ребёнком при новых точках, пока родитель сам не
  // сдвинул карту. Снова включается кнопками «К ребёнку» и «Обновить».
  bool _follow = true;
  // v0.70.2: показ геозон на карте ребёнка — по умолчанию включён, выбор
  // родителя один на все карты детей (как в веб-кабинете).
  static const _showZonesKey = 'child_map_show_zones';
  bool _showZones = true;

  @override
  void initState() {
    super.initState();
    _loadShowZones();
    WidgetsBinding.instance.addObserver(this);
    _startPolling();
    _markWatching();
    _pushSub = LiveLocationPush.childUpdates
        .where((id) => id == widget.childId)
        .listen((_) {
          // В фоне экран не обновляем: при возврате сработает resumed.
          final state = WidgetsBinding.instance.lifecycleState;
          if (state == null || state == AppLifecycleState.resumed) {
            _refresh(manual: false);
          }
        });
  }

  Future<void> _loadShowZones() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final v = prefs.getBool(_showZonesKey);
      if (v != null && mounted) setState(() => _showZones = v);
    } catch (_) {
      // не критично — остаёмся на умолчании
    }
  }

  void _toggleZones() {
    final v = !_showZones;
    setState(() => _showZones = v);
    unawaited(
      SharedPreferences.getInstance()
          .then((p) => p.setBool(_showZonesKey, v))
          .catchError((_) => false),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _pushSub?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refresh(manual: false);
      _startPolling();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _poll?.cancel();
      _poll = null;
    }
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(_pollInterval, (_) => _refresh(manual: false));
  }

  /// Сообщает серверу «смотрю карту ребёнка» — тогда о новых точках придёт
  /// тихий push. Ошибку (нет сети, старый сервер без эндпоинта) глотаем:
  /// экран всё равно обновляется опросом.
  void _markWatching() {
    ref
        .read(childrenRepositoryProvider)
        .watchLocation(widget.childId)
        .catchError((Object _) {});
  }

  /// Перезапрашивает точку и трек. Ручное обновление ждёт свежие данные
  /// и центрирует на ребёнке; фоновое — двигает камеру, только если
  /// включено слежение.
  Future<void> _refresh({required bool manual}) async {
    // Фоновый опрос не наслаивается; нажатие «Обновить» проходит всегда,
    // иначе совпадение с опросом съело бы центрирование.
    if (_refreshing && !manual) {
      _refreshAgain = true;
      return;
    }
    _refreshing = true;
    _markWatching();
    if (manual) {
      setState(() {
        _manualRefreshing = true;
        _follow = true;
      });
      ref.invalidate(zonesListProvider);
    }
    try {
      final latestF = ref.refresh(
        childLatestLocationProvider(widget.childId).future,
      );
      final trackF = ref.refresh(
        childActiveTrackProvider(widget.childId).future,
      );
      final latest = await latestF;
      // Ошибку трека покажет пустая линия, точку ребёнка она не отменяет.
      await trackF.then((_) {}, onError: (_) {});
      if (!mounted) return;
      if (manual) {
        _focusOnChild(latest);
      } else if (_follow && latest != null && !_isComfortablyVisible(latest)) {
        _focusOnChild(latest, keepZoom: true);
      }
    } catch (_) {
      // Ошибку покажет карточка поверх карты через AsyncValue.
    } finally {
      _refreshing = false;
      if (mounted && manual) setState(() => _manualRefreshing = false);
      if (_refreshAgain && mounted) {
        _refreshAgain = false;
        _refresh(manual: false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final childrenAsync = ref.watch(childrenListProvider);
    final latestAsync = ref.watch(childLatestLocationProvider(widget.childId));
    final trackAsync = ref.watch(childActiveTrackProvider(widget.childId));
    // v0.66.0: круги зон ребёнка (для всех детей или с назначением). Ошибка
    // загрузки зон карту не ломает — просто без кругов.
    final childZones = (ref.watch(zonesListProvider).valueOrNull ?? const [])
        .where((z) => z.appliesTo(widget.childId))
        .toList();

    final child = childrenAsync.maybeWhen(
      data: (list) => list.firstWhere(
        (c) => c.id == widget.childId,
        orElse: () => Child(id: widget.childId, name: 'Ребёнок'),
      ),
      orElse: () => Child(id: widget.childId, name: 'Ребёнок'),
    );

    final latest = latestAsync.value;
    final trackData = trackAsync.value ?? TrackData.empty;
    final track = trackData.points;

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
            onPressed: () => _refresh(manual: true),
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
                              : const LatLng(
                                  55.7558,
                                  37.6173,
                                ), // Москва, дефолт
                          initialZoom: latest != null ? 15 : 10,
                          minZoom: 3,
                          maxZoom: 18,
                          interactionOptions: const InteractionOptions(
                            flags:
                                InteractiveFlag.all & ~InteractiveFlag.rotate,
                          ),
                          onMapReady: () {
                            if (!mounted) return;
                            setState(() {
                              _mapReady = true;
                              _tileGen++; // форсим пересоздание TileLayer
                            });
                            _maybeFit(latest, track);
                          },
                          // Родитель сам сдвинул или приблизил карту —
                          // перестаём возвращать камеру к ребёнку.
                          onPositionChanged: (_, hasGesture) {
                            if (hasGesture) _follow = false;
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
                          if (_showZones && childZones.isNotEmpty) ...[
                            CircleLayer(circles: zoneCircles(childZones)),
                            MarkerLayer(markers: zoneCenterMarkers(childZones)),
                          ],
                          // Сплошная линия по кускам + серый пунктир на разрывах
                          // + стоянки «П». До маркера ребёнка — он рисуется поверх.
                          ...buildTrackLayers(track, stays: trackData.stays),
                          if (latest != null)
                            MarkerLayer(
                              markers: [
                                Marker(
                                  point: LatLng(latest.lat, latest.lon),
                                  width: 56,
                                  height: 56,
                                  alignment: Alignment.topCenter,
                                  child: _ChildMarker(child: child),
                                ),
                              ],
                            ),
                          const RichAttributionWidget(
                            // Атрибуция OSM обязательна по лицензии ODbL.
                            attributions: [
                              TextSourceAttribution(
                                'OpenStreetMap contributors',
                              ),
                            ],
                          ),
                        ],
                      ),
                      if (_manualRefreshing)
                        const Positioned(
                          top: 12,
                          left: 12,
                          child: Card(
                            child: Padding(
                              padding: EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 8,
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
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
                            color: Theme.of(context).colorScheme.errorContainer,
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Text(
                                'Не удалось загрузить локацию: ${latestAsync.error}',
                                style: TextStyle(
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.onErrorContainer,
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
          // ─── FAB «геозоны» — над «к ребёнку» ───────────────────────
          if (childZones.isNotEmpty)
            Positioned(
              right: 16,
              bottom: MediaQuery.of(context).size.height * 0.18 + 12 + 52,
              child: FloatingActionButton.small(
                heroTag: 'zones_${widget.childId}',
                tooltip: _showZones ? 'Скрыть геозоны' : 'Показать геозоны',
                backgroundColor: _showZones
                    ? Theme.of(context).colorScheme.primary
                    : Theme.of(context).colorScheme.surfaceContainerHigh,
                foregroundColor: _showZones
                    ? Theme.of(context).colorScheme.onPrimary
                    : Theme.of(context).colorScheme.onSurface,
                onPressed: _toggleZones,
                child: Icon(_showZones ? Icons.layers : Icons.layers_clear),
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
              onPressed: () {
                _follow = true;
                _focusOnChild(latest);
              },
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

  void _focusOnChild(ChildLocation? latest, {bool keepZoom = false}) {
    if (latest == null || !_mapReady) return;
    final zoom = keepZoom ? _map.camera.zoom : 16.0;
    _map.move(LatLng(latest.lat, latest.lon), zoom);
  }

  /// Точка ребёнка видна не у самого края и не под нижней панелью
  /// (свёрнутая панель занимает ~18% высоты). Тогда фоновое обновление
  /// камеру не трогает — не сбивает обзор трека и масштаб.
  bool _isComfortablyVisible(ChildLocation latest) {
    if (!_mapReady) return true;
    final camera = _map.camera;
    final p = camera.latLngToScreenPoint(LatLng(latest.lat, latest.lon));
    final size = camera.nonRotatedSize;
    return p.x >= size.x * 0.12 &&
        p.x <= size.x * 0.88 &&
        p.y >= size.y * 0.12 &&
        p.y <= size.y * 0.72;
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
  const _ChildMarker({required this.child});

  final Child child;

  @override
  Widget build(BuildContext context) {
    final letter = _firstLetter(child.name);
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
          // Внутри белой рамки 3px остаётся круг 34px: аватар (фото /
          // стандартный), без него — буква на зелёном, как раньше.
          child: ChildAvatar(
            name: child.name,
            childId: child.id,
            avatarKey: child.avatarKey,
            size: 34,
            fallback: (_) => Text(
              letter,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 16,
              ),
            ),
          ),
        ),
        // Маленький треугольник-указатель, чтобы было понятно, какая точно точка.
        CustomPaint(size: const Size(12, 8), painter: _ArrowPainter()),
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
