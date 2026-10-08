import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../children/child_models.dart';
import '../children/children_providers.dart';
import '../map/family_map.dart';
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

class _ZonesScreenState extends ConsumerState<ZonesScreen> {
  final FamilyMapController _map = FamilyMapController();
  String? _selectedId;

  void _focusZone(Zone z) {
    _map.move(LatLng(z.centerLat, z.centerLon), zoomForRadius(z.radius, z.centerLat));
  }

  void _createZone({LatLng? at, String? childId}) {
    final center = at ?? _map.camera?.center ?? _map.initialCenter ?? kMoscow;
    final zoom = at != null ? 16.0 : (_map.camera?.zoom ?? 15);
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
    final points = latestAsync.valueOrNull?.items ?? const <FamilyLatestPoint>[];
    final kidById = {for (final k in kids) k.id: k};
    final kidNames = {for (final k in kids) k.id: k.name};
    final canCreate = zonesAsync.hasValue && zones.length < kMaxZones;

    // Цепочка центра стартует, когда и зоны, и точки ответили (или упали).
    final zonesDone = zonesAsync.hasValue || zonesAsync.hasError;
    final latestDone = latestAsync.hasValue || latestAsync.hasError;

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
            child: FamilyMap(
              controller: _map,
              zones: zones,
              points: points,
              kidById: kidById,
              dataReady: zonesDone && latestDone,
              selectedZoneId: _selectedId,
              onZoneTap: (z) => setState(() => _selectedId = z.id),
              onKidTap: (kid, p) => _onKidTap(kid, p, canCreate),
              heroTagPrefix: 'zones',
              fitAllTooltip: 'Показать все зоны и детей',
            ),
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
                      onFocus: (p) => _map.move(LatLng(p.lat, p.lon), 16),
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
