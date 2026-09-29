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

/// «Статистика за 30 дней» в раскрытой карточке зоны.
class ZoneStatsSection extends ConsumerWidget {
  const ZoneStatsSection({super.key, required this.zoneId, required this.kidNames});

  final String zoneId;
  final Map<String, String> kidNames;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final muted = theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant);
    final async = ref.watch(zoneStatsProvider(zoneId));

    final Widget body;
    if (async.hasValue) {
      final stats = async.value!;
      final withNames = stats.children.length > 1;
      final now = DateTime.now();
      body = stats.children.isEmpty
          ? Text('Детей в зоне нет', style: muted)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final c in stats.children)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: _ChildStats(
                      name: withNames ? (kidNames[c.childId] ?? 'Ребёнок') : null,
                      lines: zoneStatsLines(c, now),
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
          'Статистика за 30 дней',
          style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        body,
      ],
    );
  }
}

class _ChildStats extends StatelessWidget {
  const _ChildStats({required this.name, required this.lines});

  /// null — в зоне один ребёнок, имя не пишем.
  final String? name;
  final List<String> lines;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < lines.length; i++)
          Text.rich(
            TextSpan(
              children: [
                if (i == 0 && name != null)
                  TextSpan(
                    text: '$name: ',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                TextSpan(text: lines[i]),
              ],
            ),
            style: i == 0 ? theme.textTheme.bodySmall : muted,
          ),
      ],
    );
  }
}
