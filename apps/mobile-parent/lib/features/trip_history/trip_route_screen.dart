import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../children/child_models.dart';
import '../children/children_providers.dart';

/// Экран маршрута одной поездки: OSM-карта (flutter_map) с polyline трека и
/// маркерами старта (зелёный) и финиша (красный).
///
/// Паттерн карты (TileLayer + onMapReady fit + tileGen workaround для
/// flutter_map 7.0.2) переиспользован из `child_detail_screen.dart`.
class TripRouteScreen extends ConsumerStatefulWidget {
  const TripRouteScreen({
    super.key,
    required this.childId,
    required this.tripId,
    required this.childName,
    this.trip,
  });

  final String childId;
  final String tripId;
  final String childName;

  /// Метаданные поездки (для заголовка). Передаётся через `extra` при push;
  /// если открыт по прямой ссылке — null, тогда заголовок общий.
  final Trip? trip;

  @override
  ConsumerState<TripRouteScreen> createState() => _TripRouteScreenState();
}

class _TripRouteScreenState extends ConsumerState<TripRouteScreen> {
  final MapController _map = MapController();
  bool _firstFitDone = false;
  bool _mapReady = false;
  int _tileGen = 0;

  @override
  Widget build(BuildContext context) {
    final key = (childId: widget.childId, tripId: widget.tripId);
    final pointsAsync = ref.watch(tripPointsProvider(key));
    final points = pointsAsync.value ?? const <ChildLocation>[];

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_firstFitDone && _mapReady && mounted) _maybeFit(points);
    });

    return Scaffold(
      appBar: AppBar(
        title: Text(_title()),
        actions: [
          IconButton(
            tooltip: 'Обновить',
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(tripPointsProvider(key));
              setState(() => _firstFitDone = false);
            },
          ),
        ],
      ),
      body: pointsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _RouteError(
          error: err,
          onRetry: () => ref.invalidate(tripPointsProvider(key)),
        ),
        data: (pts) {
          if (pts.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  'В этой поездке не сохранилось точек координат.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          return _buildMap(pts);
        },
      ),
    );
  }

  Widget _buildMap(List<ChildLocation> points) {
    final first = points.first;
    final last = points.last;

    return Stack(
      fit: StackFit.expand,
      children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: LatLng(first.lat, first.lon),
            initialZoom: 15,
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
              _maybeFit(points);
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
            if (points.length >= 2)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: points.map((p) => LatLng(p.lat, p.lon)).toList(),
                    strokeWidth: 4,
                    color: const Color(0xFF2E7D32),
                    borderStrokeWidth: 1,
                    borderColor: Colors.white,
                  ),
                ],
              ),
            MarkerLayer(
              markers: [
                Marker(
                  point: LatLng(first.lat, first.lon),
                  width: 28,
                  height: 28,
                  child: const _EndpointDot(
                    color: Color(0xFF2E7D32),
                    icon: Icons.trip_origin,
                  ),
                ),
                Marker(
                  point: LatLng(last.lat, last.lon),
                  width: 28,
                  height: 28,
                  child: const _EndpointDot(
                    color: Color(0xFFDC2626),
                    icon: Icons.place,
                  ),
                ),
              ],
            ),
            const RichAttributionWidget(
              attributions: [
                TextSourceAttribution('OpenStreetMap contributors'),
              ],
            ),
          ],
        ),
      ],
    );
  }

  void _maybeFit(List<ChildLocation> points) {
    if (_firstFitDone || points.isEmpty) return;
    if (points.length == 1) {
      _map.move(LatLng(points.first.lat, points.first.lon), 16);
      _firstFitDone = true;
      return;
    }
    final lats = points.map((p) => p.lat);
    final lons = points.map((p) => p.lon);
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
  }

  String _title() {
    final t = widget.trip;
    if (t == null) return 'Маршрут';
    final dt = t.startedAt;
    const months = <String>[
      'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
    ];
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    return 'Маршрут — ${dt.day} ${months[dt.month - 1]}, $hh:$mm';
  }
}

class _EndpointDot extends StatelessWidget {
  const _EndpointDot({required this.color, required this.icon});

  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: color, width: 3),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 3,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      alignment: Alignment.center,
      child: Icon(icon, size: 14, color: color),
    );
  }
}

class _RouteError extends StatelessWidget {
  const _RouteError({required this.error, required this.onRetry});

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
            Icon(Icons.error_outline,
                size: 48, color: Theme.of(context).colorScheme.error),
            const SizedBox(height: 16),
            Text(
              'Не удалось загрузить маршрут',
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
