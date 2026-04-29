import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

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

    // После того, как данные пришли — один раз центрируем карту.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_firstFitDone && mounted) _maybeFit(latest, track);
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
            child: Stack(
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
                  ),
                  children: [
                    // OSM tile-сервер. Соблюдаем Tile Usage Policy:
                    // userAgentPackageName идентифицирует наш проект.
                    // https://operations.osmfoundation.org/policies/tiles/
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'ru.link28rus.gmd.gmd_parent',
                      maxNativeZoom: 19,
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

class _BottomPanel extends StatelessWidget {
  const _BottomPanel({required this.child, required this.latest});

  final Child child;
  final ChildLocation? latest;

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
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _LocationLine(latest: latest),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _ActionTile(
                  icon: Icons.notifications_active_outlined,
                  label: 'Сигнал',
                  onTap: () => _showSnack(context, 'Сигнал — следующий шаг'),
                ),
              ),
              Expanded(
                child: _ActionTile(
                  icon: Icons.hearing_outlined,
                  label: 'Звук',
                  onTap: () => _showSnack(context, 'Звук — следующий шаг'),
                ),
              ),
              Expanded(
                child: _ActionTile(
                  icon: Icons.shield_outlined,
                  label: 'Геозоны',
                  onTap: () => _showSnack(context, 'Геозоны — следующий шаг'),
                ),
              ),
              Expanded(
                child: _ActionTile(
                  icon: Icons.map_outlined,
                  label: 'Я.Карты',
                  onTap: latest == null ? null : () => _openInYandexMaps(latest!),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _showSnack(BuildContext context, String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _openInYandexMaps(ChildLocation latest) async {
    // Внешний просмотр в системном браузере / Я.Карты-приложении —
    // там детализация лучше OSM, особенно дома и подъезды в РФ.
    final uri = Uri.parse(
      'https://yandex.ru/maps/?pt=${latest.lon},${latest.lat}&z=16&l=map',
    );
    await launchUrl(uri, mode: LaunchMode.externalApplication);
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
class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.icon, required this.label, this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

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
            Icon(icon, size: 26, color: color),
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
