import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../../core/api/api_exception.dart';
import '../children/child_models.dart';
import '../children/children_providers.dart';

/// Экран ребёнка: OSM-карта (flutter_map) + последняя локация + активный
/// трек + быстрые действия. Phase B Step 1.5 — переход с Yandex MapKit на
/// OpenStreetMap (бесплатно, без ключа, без санкционных рисков).
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
      body: Column(
        children: [
          Expanded(
            // Строим FlutterMap ТОЛЬКО когда есть позиция (или явно зафикси-
            // ровано что у ребёнка нет точек). Иначе на rebuild после прихода
            // latest у уже смонтированного MapController остаётся старый viewport
            // на Москве, а TileLayer 7.x не запускает fetch tiles для нового
            // viewport до первого user-event (карта остаётся серой пока не
            // зумишь). Условный mount решает это радикально и чисто.
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
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'ru.link28rus.gmd.gmd_parent',
                      maxNativeZoom: 19,
                      // Держим больше tiles вокруг viewport — меньше «серой
                      // мозаики» при панорамировании / первом отображении.
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
                Positioned(
                  bottom: 12,
                  right: 12,
                  child: FloatingActionButton.small(
                    heroTag: 'follow_${widget.childId}',
                    tooltip: 'К ребёнку',
                    onPressed: () => _focusOnChild(latest),
                    child: const Icon(Icons.my_location),
                  ),
                ),
              ],
            ),
          ),
          _BottomPanel(child: child, latest: latest),
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

class _BottomPanel extends ConsumerStatefulWidget {
  const _BottomPanel({required this.child, required this.latest});

  final Child child;
  final ChildLocation? latest;

  @override
  ConsumerState<_BottomPanel> createState() => _BottomPanelState();
}

class _BottomPanelState extends ConsumerState<_BottomPanel> {
  bool _signalSending = false;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 8,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      // SafeArea учитывает system navigation bar (3-кнопочный или жестовый),
      // иначе плитки действий упираются в кнопки Android и обрезаются.
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _LocationLine(latest: widget.latest),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _ActionTile(
                      icon: Icons.notifications_active_outlined,
                      label: 'Сигнал',
                      busy: _signalSending,
                      onTap: _signalSending ? null : _onSignalTap,
                    ),
                  ),
                  Expanded(
                    child: _ActionTile(
                      icon: Icons.hearing_outlined,
                      label: 'Звук',
                      onTap: () => _showSnack('Звук — следующий шаг'),
                    ),
                  ),
                  Expanded(
                    child: _ActionTile(
                      icon: Icons.shield_outlined,
                      label: 'Геозоны',
                      onTap: () => _showSnack('Геозоны — следующий шаг'),
                    ),
                  ),
                  Expanded(
                    child: _ActionTile(
                      icon: Icons.app_blocking_outlined,
                      label: 'Блокировка',
                      onTap: () => _showSnack('Блокировка приложений — следующий шаг'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _onSignalTap() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Отправить сигнал?'),
        content: Text(
          '${widget.child.name} услышит громкую сирену даже если телефон '
          'на беззвучном. Используется чтобы найти телефон или привлечь внимание.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Отправить'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _signalSending = true);
    try {
      await ref.read(childrenRepositoryProvider).sendSignal(widget.child.id);
      if (!mounted) return;
      _showSnack('Сигнал отправлен — телефон должен зазвучать в течение нескольких секунд');
    } on ApiException catch (e) {
      if (!mounted) return;
      _showSnack(_signalErrorText(e), error: true);
    } catch (e) {
      if (!mounted) return;
      _showSnack('Не удалось отправить сигнал: $e', error: true);
    } finally {
      if (mounted) setState(() => _signalSending = false);
    }
  }

  String _signalErrorText(ApiException e) {
    if (e.isRateLimited) return 'Слишком частые сигналы. Подождите минуту.';
    switch (e.code) {
      case 'no_active_device':
        return 'У ребёнка нет активного устройства — приложение GMD не установлено или удалено.';
      case 'child_not_found':
        return 'Ребёнок не найден.';
      case 'consent_required':
        return 'Сначала примите согласие на использование сервиса.';
      default:
        return e.message ?? 'Не удалось отправить сигнал (код ${e.status}).';
    }
  }

  void _showSnack(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: error ? Colors.red.shade700 : null,
      ),
    );
  }
}

class _LocationLine extends StatelessWidget {
  const _LocationLine({required this.latest});

  final ChildLocation? latest;

  @override
  Widget build(BuildContext context) {
    final l = latest;
    if (l == null) {
      return const Text('Точек ещё нет — ребёнок не подключал устройство.');
    }
    final ago = _formatAgo(l.recordedAt);
    final battery = l.battery != null ? '🔋 ${l.battery}%' : null;
    final accuracy = l.accuracy != null
        ? 'точность ±${l.accuracy!.toStringAsFixed(0)} м'
        : null;
    final coordinates = '${l.lat.toStringAsFixed(5)}, ${l.lon.toStringAsFixed(5)}';
    final extras = [battery, accuracy].where((s) => s != null).join(' · ');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.schedule, size: 16),
            const SizedBox(width: 6),
            Text(ago, style: const TextStyle(fontWeight: FontWeight.w600)),
          ],
        ),
        const SizedBox(height: 4),
        Text(coordinates, style: TextStyle(color: Colors.grey.shade700, fontSize: 12)),
        if (extras.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(extras, style: TextStyle(color: Colors.grey.shade700, fontSize: 12)),
          ),
      ],
    );
  }

  String _formatAgo(DateTime t) {
    final diff = DateTime.now().difference(t);
    if (diff.inMinutes < 1) return 'Сейчас';
    if (diff.inMinutes < 60) return '${diff.inMinutes} мин назад';
    if (diff.inHours < 24) return '${diff.inHours} ч назад';
    final fmt = DateFormat('d MMM HH:mm', 'ru_RU');
    return fmt.format(t);
  }
}

/// Кнопка-плитка: иконка сверху, подпись снизу. Растягивается через Expanded
/// в Row — все 4 действия гарантированно помещаются на любом экране.
/// Если [busy]=true — вместо иконки показывается спиннер (для in-flight операций).
class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.label,
    this.onTap,
    this.busy = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final disabled = onTap == null;
    final color = disabled
        ? Theme.of(context).disabledColor
        : Theme.of(context).colorScheme.primary;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              height: 26,
              width: 26,
              child: busy
                  ? Padding(
                      padding: const EdgeInsets.all(3),
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        valueColor: AlwaysStoppedAnimation(color),
                      ),
                    )
                  : Icon(icon, size: 26, color: color),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              style: TextStyle(fontSize: 12, color: color),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
