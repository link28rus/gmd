import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../children/child_models.dart';
import '../children/children_providers.dart';
import 'zone_format.dart';
import 'zone_models.dart';
import 'zones_providers.dart';

/// Лента событий зон (спека 3.1): `/home/zones/events?zoneId=&childId=`.
/// Фильтры по ребёнку и зоне, «Показать ещё» по курсору, все четыре типа
/// событий, даты «Сегодня / Вчера / 12 сентября» по времени фикса.
class ZoneEventsScreen extends ConsumerStatefulWidget {
  const ZoneEventsScreen({super.key, this.initialChildId, this.initialZoneId});

  final String? initialChildId;
  final String? initialZoneId;

  @override
  ConsumerState<ZoneEventsScreen> createState() => _ZoneEventsScreenState();
}

class _ZoneEventsScreenState extends ConsumerState<ZoneEventsScreen> {
  late String? _childIdRaw = widget.initialChildId;
  late String? _zoneIdRaw = widget.initialZoneId;

  @override
  void didUpdateWidget(covariant ZoneEventsScreen old) {
    super.didUpdateWidget(old);
    // Новый переход из push на уже открытую ленту — фильтр из адреса.
    if (old.initialChildId != widget.initialChildId ||
        old.initialZoneId != widget.initialZoneId) {
      _childIdRaw = widget.initialChildId;
      _zoneIdRaw = widget.initialZoneId;
    }
  }

  @override
  Widget build(BuildContext context) {
    final zonesAsync = ref.watch(zonesListProvider);
    final kidsAsync = ref.watch(childrenListProvider);

    final listsPending = (!zonesAsync.hasValue && !zonesAsync.hasError) ||
        (!kidsAsync.hasValue && !kidsAsync.hasError);
    if (listsPending) {
      return Scaffold(
        appBar: AppBar(title: const Text('События зон')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final zones = zonesAsync.valueOrNull ?? const <Zone>[];
    final kids = kidsAsync.valueOrNull ?? const <Child>[];
    // Как в кабинете: выбранных в фильтре зону/ребёнка удалили — фильтр по
    // ним не применяем. Список не загрузился — верим id из адреса.
    final childId = (kidsAsync.hasValue && !kids.any((k) => k.id == _childIdRaw))
        ? null
        : _childIdRaw;
    final zoneId = (zonesAsync.hasValue && !zones.any((z) => z.id == _zoneIdRaw))
        ? null
        : _zoneIdRaw;
    final filter = (childId: childId, zoneId: zoneId);
    final state = ref.watch(zoneEventsProvider(filter));
    final ctrl = ref.read(zoneEventsProvider(filter).notifier);
    final filtered = childId != null || zoneId != null;
    // Срок «не пришёл» — из текущих настроек зоны (в событии его нет).
    final deadlines = {for (final z in zones) z.id: z.arrival?.deadlineMin};

    return Scaffold(
      appBar: AppBar(title: const Text('События зон')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
            child: Row(
              children: [
                Expanded(
                  child: DropdownButton<String?>(
                    isExpanded: true,
                    value: childId,
                    hint: const Text('Все дети'),
                    items: [
                      const DropdownMenuItem<String?>(value: null, child: Text('Все дети')),
                      for (final k in kids)
                        DropdownMenuItem<String?>(
                          value: k.id,
                          child: Text(k.name, overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (v) => setState(() => _childIdRaw = v),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: DropdownButton<String?>(
                    isExpanded: true,
                    value: zoneId,
                    hint: const Text('Все зоны'),
                    items: [
                      const DropdownMenuItem<String?>(value: null, child: Text('Все зоны')),
                      for (final z in zones)
                        DropdownMenuItem<String?>(
                          value: z.id,
                          child: Text(z.name, overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (v) => setState(() => _zoneIdRaw = v),
                  ),
                ),
                IconButton(
                  tooltip: 'Сбросить фильтры',
                  icon: const Icon(Icons.filter_alt_off_outlined),
                  onPressed: filtered
                      ? () => setState(() {
                            _childIdRaw = null;
                            _zoneIdRaw = null;
                          })
                      : null,
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: ctrl.refresh,
              child: _buildBody(context, state, ctrl, filtered, deadlines),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    ZoneEventsState state,
    ZoneEventsController ctrl,
    bool filtered,
    Map<String, int?> deadlines,
  ) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    Widget message(String text, {Widget? action}) => ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 24),
            Text(
              text,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
            ),
            if (action != null) ...[const SizedBox(height: 12), Center(child: action)],
          ],
        );

    if (state.loading && state.items.isEmpty) {
      return ListView(children: const [
        SizedBox(height: 48),
        Center(child: CircularProgressIndicator()),
      ]);
    }
    if (state.error != null && state.items.isEmpty) {
      return message(
        zoneErrorMessage(state.error!, ZoneAction.events),
        action: FilledButton.tonal(onPressed: ctrl.refresh, child: const Text('Повторить')),
      );
    }
    if (state.items.isEmpty) {
      return message(filtered
          ? 'По выбранным фильтрам событий нет.'
          : 'Событий пока нет — они появятся, когда ребёнок войдёт в зону или выйдет из неё.');
    }

    final groups = groupEventsByDay(state.items, DateTime.now());
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        for (final g in groups) ...[
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 4),
            child: Text(
              g.label.toUpperCase(),
              style: theme.textTheme.labelSmall?.copyWith(
                color: scheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.6,
              ),
            ),
          ),
          for (final e in g.items) _EventRow(event: e, deadlineMin: deadlines[e.zoneId]),
        ],
        if (state.hasMore || state.loadingMore) ...[
          const SizedBox(height: 12),
          Center(
            child: OutlinedButton(
              onPressed: state.loadingMore ? null : ctrl.loadMore,
              child: Text(state.loadingMore ? 'Загружаем…' : 'Показать ещё'),
            ),
          ),
        ],
        if (state.loadMoreError != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              zoneErrorMessage(state.loadMoreError!, ZoneAction.events),
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.error),
            ),
          ),
      ],
    );
  }
}

class _EventRow extends StatelessWidget {
  const _EventRow({required this.event, required this.deadlineMin});

  final ZoneEvent event;
  final int? deadlineMin;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final line = zoneEventLine(event, deadlineMin: deadlineMin);
    final zoneColor = parseZoneColor(event.zoneColor);
    final isDark = theme.brightness == Brightness.dark;
    final warnColor = isDark ? const Color(0xFFFBBF24) : const Color(0xFFB45309);

    final (IconData icon, Color iconColor) = switch (line.tone) {
      ZoneEventTone.alert => (Icons.warning_amber_rounded, scheme.error),
      ZoneEventTone.warning => (Icons.wifi_off_rounded, warnColor),
      ZoneEventTone.normal => (zoneIconData(event.zoneIcon), zoneColor),
    };
    final actionColor = switch (line.tone) {
      ZoneEventTone.alert => scheme.error,
      ZoneEventTone.warning => warnColor,
      ZoneEventTone.normal => null,
    };

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 46,
            child: Text(
              formatClock(event.recordedAt),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 1, right: 8),
            child: Icon(icon, size: 18, color: iconColor),
          ),
          Expanded(
            child: Text.rich(
              TextSpan(
                style: theme.textTheme.bodyMedium,
                children: [
                  TextSpan(
                    text: line.childName,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const TextSpan(text: ' — '),
                  TextSpan(text: line.action, style: TextStyle(color: actionColor)),
                  const TextSpan(text: ' '),
                  TextSpan(
                    text: '«${line.zoneName}»',
                    style: TextStyle(color: zoneColor, fontWeight: FontWeight.w500),
                  ),
                  if (line.extra != null)
                    TextSpan(
                      text: line.extra,
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
