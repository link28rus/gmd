import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../children/child_models.dart';
import '../../children/widgets/child_avatar.dart';
import '../zone_format.dart';
import '../zone_models.dart';
import '../zones_providers.dart';

/// Удалить зону после подтверждения. true — удалена (список уже обновлён).
Future<bool> deleteZoneWithConfirm(BuildContext context, WidgetRef ref, Zone zone) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Удалить зону «${zone.name}»?'),
      content: const Text(
        'Уведомления о входе и выходе по этой зоне прекратятся, её события исчезнут из ленты.',
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Отмена')),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(ctx).colorScheme.error,
            foregroundColor: Theme.of(ctx).colorScheme.onError,
          ),
          onPressed: () => Navigator.of(ctx).pop(true),
          child: const Text('Удалить'),
        ),
      ],
    ),
  );
  if (ok != true || !context.mounted) return false;
  final messenger = ScaffoldMessenger.of(context);
  try {
    await ref.read(zonesRepositoryProvider).delete(zone.id);
    ref.invalidate(zonesListProvider);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text('Зона удалена')));
    return true;
  } catch (e) {
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(zoneErrorMessage(e, ZoneAction.delete))));
    return false;
  }
}

/// Круги зон для `CircleLayer` (радиус в метрах). [selectedId] — толще контур.
List<CircleMarker> zoneCircles(Iterable<Zone> zones, {String? selectedId}) => [
      for (final z in zones)
        CircleMarker(
          point: LatLng(z.centerLat, z.centerLon),
          radius: z.radius.toDouble(),
          useRadiusInMeter: true,
          color: parseZoneColor(z.color).withValues(alpha: z.id == selectedId ? 0.28 : 0.16),
          borderColor: parseZoneColor(z.color),
          borderStrokeWidth: z.id == selectedId ? 3 : 2,
        ),
    ];

/// Значок зоны в центре круга (цвет + иконка) — чтобы на карте было видно,
/// где какая зона.
List<Marker> zoneCenterMarkers(Iterable<Zone> zones, {void Function(Zone)? onTap}) => [
      for (final z in zones)
        Marker(
          point: LatLng(z.centerLat, z.centerLon),
          width: 28,
          height: 28,
          child: GestureDetector(
            onTap: onTap == null ? null : () => onTap(z),
            child: Container(
              decoration: BoxDecoration(
                color: parseZoneColor(z.color),
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 2),
              ),
              alignment: Alignment.center,
              child: Icon(zoneIconData(z.icon), size: 15, color: Colors.white),
            ),
          ),
        ),
    ];

/// Маркер ребёнка на карте зон: аватар + имя.
class KidMapMarker extends StatelessWidget {
  const KidMapMarker({super.key, required this.child, this.onTap});

  final Child child;
  final VoidCallback? onTap;

  static const width = 96.0;
  static const height = 62.0;

  @override
  Widget build(BuildContext context) {
    final letter = child.name.trim().isEmpty
        ? '?'
        : child.name.trim().characters.first.toUpperCase();
    return GestureDetector(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            constraints: const BoxConstraints(maxWidth: width),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.2), blurRadius: 3),
              ],
            ),
            child: Text(
              child.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: Colors.black87,
              ),
            ),
          ),
          const SizedBox(height: 2),
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: const Color(0xFF2E7D32),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 3),
            ),
            alignment: Alignment.center,
            child: ChildAvatar(
              name: child.name,
              childId: child.id,
              avatarKey: child.avatarKey,
              size: 30,
              fallback: (_) => Text(
                letter,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Значки «по расписанию Пн–Пт 08:00–15:00» и «срок 08:30».
class ZoneRuleBadges extends StatelessWidget {
  const ZoneRuleBadges({super.key, required this.zone});

  final Zone zone;

  @override
  Widget build(BuildContext context) {
    final schedule = zone.schedule;
    final arrival = zone.arrival;
    if (schedule == null && arrival == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Wrap(
        spacing: 6,
        runSpacing: 4,
        children: [
          if (schedule != null)
            _Badge(
              icon: Icons.event_available_outlined,
              text: 'по расписанию ${formatScheduleShort(schedule)}',
            ),
          if (arrival != null)
            _Badge(
              icon: Icons.alarm_outlined,
              text: 'срок ${minutesToHhmm(arrival.deadlineMin)}',
            ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: scheme.onSurfaceVariant),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              text,
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

/// Чипы дней недели (бит 0 — Пн … бит 6 — Вс).
class DayChips extends StatelessWidget {
  const DayChips({super.key, required this.mask, required this.onChanged});

  final int mask;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (var i = 0; i < 7; i++)
          FilterChip(
            label: Text(kWeekdayShort[i]),
            selected: hasDay(mask, i),
            showCheckmark: false,
            visualDensity: VisualDensity.compact,
            onSelected: (_) => onChanged(toggleDay(mask, i)),
          ),
      ],
    );
  }
}

/// «Мои уведомления» в карточке зоны: по каждому ребёнку «приход», «уход»,
/// «не пришёл к сроку». Переключатель сохраняется сразу; уходит полный набор
/// по всем детям зоны (PUT заменяет настройки текущего пользователя).
class MyZoneNotifications extends ConsumerStatefulWidget {
  const MyZoneNotifications({super.key, required this.zone, required this.kidNames});

  final Zone zone;
  final Map<String, String> kidNames;

  @override
  ConsumerState<MyZoneNotifications> createState() => _MyZoneNotificationsState();
}

enum _PrefField { entry, exit, missed }

class _MyZoneNotificationsState extends ConsumerState<MyZoneNotifications> {
  late List<ZoneChildPrefs> _prefs = widget.zone.myPrefs;
  bool _saving = false;

  @override
  void didUpdateWidget(covariant MyZoneNotifications old) {
    super.didUpdateWidget(old);
    // Свежие данные с сервера (обновили список) — если не сохраняем сейчас.
    if (!_saving && old.zone.myPrefs != widget.zone.myPrefs) {
      _prefs = widget.zone.myPrefs;
    }
  }

  Future<void> _toggle(String childId, _PrefField field, bool value) async {
    final before = _prefs;
    final next = [
      for (final p in _prefs)
        if (p.childId != childId)
          p
        else
          switch (field) {
            _PrefField.entry => p.copyWith(onEntry: value),
            _PrefField.exit => p.copyWith(onExit: value),
            _PrefField.missed => p.copyWith(onMissedArrival: value),
          },
    ];
    setState(() {
      _prefs = next;
      _saving = true;
    });
    try {
      final saved =
          await ref.read(zonesRepositoryProvider).setMyNotifications(widget.zone.id, next);
      if (!mounted) return;
      setState(() => _prefs = saved.isEmpty ? next : saved);
      ref.invalidate(zonesListProvider);
    } catch (e) {
      if (!mounted) return;
      setState(() => _prefs = before);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(zoneErrorMessage(e, ZoneAction.prefs))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final prefs = _prefs.where((p) => widget.kidNames.containsKey(p.childId)).toList();
    final hasArrival = widget.zone.arrival != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Мои уведомления',
            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
        Text(
          'Только для вас — у другого родителя свои настройки.',
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 4),
        if (prefs.isEmpty)
          Text('В зоне пока нет детей.',
              style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant))
        else
          for (final p in prefs) ...[
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(widget.kidNames[p.childId] ?? '',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
            _PrefSwitch(
              label: 'Приход',
              value: p.onEntry,
              onChanged: _saving ? null : (v) => _toggle(p.childId, _PrefField.entry, v),
            ),
            _PrefSwitch(
              label: 'Уход',
              value: p.onExit,
              onChanged: _saving ? null : (v) => _toggle(p.childId, _PrefField.exit, v),
            ),
            _PrefSwitch(
              label: 'Не пришёл к сроку',
              subtitle: hasArrival ? null : 'У зоны не задан срок — включите его в настройках зоны',
              value: hasArrival && p.onMissedArrival,
              onChanged: (_saving || !hasArrival)
                  ? null
                  : (v) => _toggle(p.childId, _PrefField.missed, v),
            ),
          ],
      ],
    );
  }
}

class _PrefSwitch extends StatelessWidget {
  const _PrefSwitch({
    required this.label,
    required this.value,
    required this.onChanged,
    this.subtitle,
  });

  final String label;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      visualDensity: VisualDensity.compact,
      title: Text(label),
      subtitle: subtitle == null ? null : Text(subtitle!),
      value: value,
      onChanged: onChanged,
    );
  }
}
