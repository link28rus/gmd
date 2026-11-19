import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../zone_format.dart';
import '../zone_models.dart';
import '../zones_providers.dart';

// Геозоны v2, этап 4: «Подсказки мест» на экране зон и статистика визитов в
// раскрытой карточке зоны.

/// Секция «Подсказки». Пока грузится, при ошибке (старый backend — 404) и при
/// пустом списке не показывается вовсе.
class ZonePlaceSuggestions extends ConsumerWidget {
  const ZonePlaceSuggestions({
    super.key,
    required this.kidNames,
    required this.canCreate,
    required this.onSave,
  });

  /// Имена детей семьи; префикс «Маша: » — только если детей больше одного.
  final Map<String, String> kidNames;

  /// Лимит зон не достигнут — «Сохранить» доступно.
  final bool canCreate;
  final ValueChanged<PlaceSuggestion> onSave;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(zoneSuggestionsProvider).valueOrNull ?? const [];
    if (items.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Подсказки',
            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          for (final s in items)
            _SuggestionCard(
              key: ValueKey(s.id),
              suggestion: s,
              kidNames: kidNames,
              canCreate: canCreate,
              onSave: () => onSave(s),
            ),
        ],
      ),
    );
  }
}

class _SuggestionCard extends ConsumerStatefulWidget {
  const _SuggestionCard({
    super.key,
    required this.suggestion,
    required this.kidNames,
    required this.canCreate,
    required this.onSave,
  });

  final PlaceSuggestion suggestion;
  final Map<String, String> kidNames;
  final bool canCreate;
  final VoidCallback onSave;

  @override
  ConsumerState<_SuggestionCard> createState() => _SuggestionCardState();
}

class _SuggestionCardState extends ConsumerState<_SuggestionCard> {
  bool _dismissing = false;

  Future<void> _dismiss() async {
    setState(() => _dismissing = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(zonesRepositoryProvider).dismissSuggestion(widget.suggestion);
      if (!mounted) return;
      ref.invalidate(zoneSuggestionsProvider);
    } catch (e) {
      if (!mounted) return;
      setState(() => _dismissing = false);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(zoneErrorMessage(e, ZoneAction.dismiss))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final s = widget.suggestion;
    final color = parseZoneColor(s.color);
    final withNames = widget.kidNames.length > 1;
    final muted = theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant);

    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 14,
                  backgroundColor: color.withValues(alpha: 0.16),
                  child: Icon(zoneIconData(s.icon), size: 16, color: color),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    placeSuggestionTitle(s.kind),
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            for (final c in s.children)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  '${withNames ? '${widget.kidNames[c.childId] ?? 'Ребёнок'}: ' : ''}'
                  '${placeEvidenceLine(s.kind, c)}',
                  style: muted,
                ),
              ),
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                TextButton(
                  onPressed: _dismissing ? null : _dismiss,
                  child: const Text('Больше не показывать'),
                ),
                FilledButton.tonal(
                  onPressed: widget.canCreate && !_dismissing ? widget.onSave : null,
                  child: const Text('Сохранить'),
                ),
              ],
            ),
            if (!widget.canCreate)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('Достигнут лимит зон', style: muted),
              ),
          ],
        ),
      ),
    );
  }
}

/// Статистика в раскрытой карточке зоны.
class ZoneStatsSection extends ConsumerStatefulWidget {
  const ZoneStatsSection({super.key, required this.zoneId, required this.kidNames});

  final String zoneId;
  final Map<String, String> kidNames;

  @override
  ConsumerState<ZoneStatsSection> createState() => _ZoneStatsSectionState();
}

class _ZoneStatsSectionState extends ConsumerState<ZoneStatsSection> {
  static const _labels = {
    ZoneStatsPeriod.today: 'Сегодня',
    ZoneStatsPeriod.week: '7 дней',
    ZoneStatsPeriod.month: '30 дней',
  };
  var _period = ZoneStatsPeriod.week;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final muted = theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant);
    final async = ref.watch(zoneStatsProvider((zoneId: widget.zoneId, period: _period)));

    final Widget body;
    if (async.hasValue) {
      final stats = async.value!;
      final withNames = stats.children.length > 1;
      final now = DateTime.now();
      body = stats.children.isEmpty
          ? Text('К зоне пока не привязаны дети.', style: muted)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final c in stats.children)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _ChildStats(
                      name: withNames ? (widget.kidNames[c.childId] ?? 'Ребёнок') : null,
                      stats: c,
                      now: now,
                    ),
                  ),
              ],
            );
    } else if (async.hasError) {
      body = Text('Не удалось загрузить статистику', style: muted);
    } else {
      body = const Padding(
        padding: EdgeInsets.symmetric(vertical: 6),
        child: LinearProgressIndicator(minHeight: 2),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Статистика зоны',
          style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
        ),
        Wrap(
          spacing: 6,
          children: [
            for (final period in _labels.entries)
              ChoiceChip(
                label: Text(period.value),
                selected: _period == period.key,
                onSelected: (_) => setState(() => _period = period.key),
              ),
          ],
        ),
        const SizedBox(height: 6),
        body,
      ],
    );
  }
}

class _ChildStats extends StatelessWidget {
  const _ChildStats({required this.name, required this.stats, required this.now});

  /// null — в зоне один ребёнок, имя не пишем.
  final String? name;
  final ZoneChildStats stats;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (name case final childName?) Text(childName, style: theme.textTheme.labelLarge),
        if (stats.visits == 0)
          Text('Нет подтверждённых визитов за этот период.', style: muted)
        else ...[
          Text('В зоне · ${formatDuration(stats.totalSec)}', style: theme.textTheme.titleSmall),
          Text(
            '${visitsCount(stats.visits)} · в среднем ${formatDuration(stats.avgSec)}',
            style: muted,
          ),
          for (final line in zoneStatsLines(stats, now).skip(1)) Text(line, style: muted),
          const SizedBox(height: 6),
          _ZoneAppUsage(usage: stats.usage),
        ],
      ],
    );
  }
}

class _ZoneAppUsage extends StatelessWidget {
  const _ZoneAppUsage({required this.usage});

  final ZoneUsage? usage;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final data = usage;
    if (data == null || data.coverage == ZoneUsageCoverage.none) {
      return Text('Нет данных об использовании приложений в зоне.', style: muted);
    }
    final total = data.totalSec > 0 ? formatDuration(data.totalSec) : '0 мин';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Экранное время · $total', style: theme.textTheme.labelLarge),
        for (final app in data.apps)
          Row(
            children: [
              Expanded(child: Text(app.appLabel?.isNotEmpty == true ? app.appLabel! : app.packageName)),
              const SizedBox(width: 8),
              Text(formatDuration(app.seconds)),
            ],
          ),
        if (data.coverage == ZoneUsageCoverage.partial)
          Text('Данные об активности есть за часть времени в зоне.', style: muted),
      ],
    );
  }
}
