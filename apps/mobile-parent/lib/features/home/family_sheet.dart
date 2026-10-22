import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../children/child_models.dart';
import '../children/widgets/child_avatar.dart';
import '../map/battery.dart';
import '../map/family_map.dart';
import '../zones/widgets/zone_widgets.dart';
import '../zones/zone_format.dart';
import '../zones/zone_models.dart';

/// Содержимое шторки главного экрана (v0.86.0): строки «Дети» / «Взрослые»
/// и карточка выбранного человека. Состояние (кто выбран) держит HomeScreen.

/// «Здесь 5 мин назад» — без рода, подходит и детям, и взрослым.
String placeAge(int ageSec) => 'Здесь ${formatAgeShort(ageSec)}';

String? accuracyText(double? accuracy) {
  if (accuracy == null || !accuracy.isFinite || accuracy <= 0) return null;
  return 'точность ±${accuracy.round()} м';
}

String parentTitle(FamilyLatestParent p) =>
    p.isMe ? 'Вы' : (p.name.trim().isEmpty ? 'Взрослый' : p.name.trim());

void openChild(BuildContext context, Child child, [String sub = '']) {
  final name = Uri.encodeQueryComponent(child.name);
  context.push(
    sub.isEmpty ? '/home/child/${child.id}' : '/home/child/${child.id}/$sub?name=$name',
  );
}

/// Заголовок раздела в шторке.
class SheetSectionTitle extends StatelessWidget {
  const SheetSectionTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
      child: Text(
        text,
        style: theme.textTheme.labelLarge?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// Аватар ребёнка с зелёной точкой «онлайн».
class KidAvatar extends StatelessWidget {
  const KidAvatar({super.key, required this.child, this.size = 44});

  final Child child;
  final double size;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final online = child.isOnline;
    final initials = child.name.trim().isNotEmpty
        ? child.name.trim().split(' ').take(2).map((s) => s.characters.first).join()
        : '?';
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          ChildAvatar(
            name: child.name,
            childId: child.id,
            avatarKey: child.avatarKey,
            size: size,
            fallback: (_) => CircleAvatar(
              radius: size / 2,
              backgroundColor:
                  online ? scheme.primaryContainer : scheme.surfaceContainerHighest,
              child: Text(
                initials.toUpperCase(),
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: online ? scheme.onPrimaryContainer : scheme.onSurfaceVariant,
                ),
              ),
            ),
          ),
          if (online)
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                width: 13,
                height: 13,
                decoration: BoxDecoration(
                  color: AppColors.online,
                  shape: BoxShape.circle,
                  border: Border.all(color: scheme.surface, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Значок взрослого — как метка на карте: синий скруглённый квадрат.
class ParentAvatar extends StatelessWidget {
  const ParentAvatar({super.key, required this.parent, this.size = 44});

  final FamilyLatestParent parent;
  final double size;

  @override
  Widget build(BuildContext context) {
    final stale = parent.ageSec > kStalePointSec;
    final name = parent.name.trim();
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: stale ? kStaleMarkerBorder : kParentMarkerColor,
        borderRadius: BorderRadius.circular(size / 4),
      ),
      alignment: Alignment.center,
      child: parent.isMe || name.isEmpty
          ? Icon(parent.isMe ? Icons.person_pin : Icons.person,
              color: Colors.white, size: size * 0.55)
          : Text(
              name.characters.first.toUpperCase(),
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: size * 0.4,
              ),
            ),
    );
  }
}

/// Строка ребёнка: нажатие — выбрать на карте (если есть точка), стрелка —
/// сразу экран ребёнка.
class KidSheetRow extends StatelessWidget {
  const KidSheetRow({
    super.key,
    required this.child,
    required this.point,
    required this.onSelect,
  });

  final Child child;
  final FamilyLatestPoint? point;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final p = point;
    final stale = p == null || p.ageSec > kStalePointSec;
    return ListTile(
      contentPadding: const EdgeInsets.only(left: 20, right: 8),
      leading: KidAvatar(child: child),
      title: Text(child.name, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(
        p != null ? placeAge(p.ageSec) : _deviceStatus(child),
        style: theme.textTheme.bodyMedium?.copyWith(
          color: stale ? scheme.onSurfaceVariant : AppColors.online,
        ),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          BatteryBadge(level: p?.batteryLevel, charging: p?.isCharging),
          IconButton(
            tooltip: 'Открыть',
            icon: Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
            onPressed: () => openChild(context, child),
          ),
        ],
      ),
      onTap: p != null ? onSelect : () => openChild(context, child),
    );
  }

  static String _deviceStatus(Child child) {
    final d = child.device;
    if (d == null) return 'Устройство ещё не подключено';
    if (d.revokedAt != null) return 'Доступ отозван';
    final last = d.lastSeenAt;
    if (last == null) return 'Ещё не выходил на связь';
    return 'Пока нет координат';
  }
}

/// Строка взрослого семьи (виден, пока у него включено «Показывать меня семье»).
class ParentSheetRow extends StatelessWidget {
  const ParentSheetRow({super.key, required this.parent, required this.onSelect});

  final FamilyLatestParent parent;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final stale = parent.ageSec > kStalePointSec;
    return ListTile(
      contentPadding: const EdgeInsets.only(left: 20, right: 20),
      leading: ParentAvatar(parent: parent),
      title: Text(parentTitle(parent), style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(
        placeAge(parent.ageSec),
        style: theme.textTheme.bodyMedium?.copyWith(
          color: stale ? scheme.onSurfaceVariant : AppColors.online,
        ),
      ),
      trailing: BatteryBadge(level: parent.batteryLevel, charging: parent.isCharging),
      onTap: onSelect,
    );
  }
}

/// Карточка выбранного человека в шторке.
class MemberCard extends StatelessWidget {
  const MemberCard.kid({
    super.key,
    required Child this.child,
    required FamilyLatestPoint this.point,
    required this.onClose,
  }) : parent = null;

  const MemberCard.parent({
    super.key,
    required FamilyLatestParent this.parent,
    required this.onClose,
  })  : child = null,
        point = null;

  final Child? child;
  final FamilyLatestPoint? point;
  final FamilyLatestParent? parent;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final kid = child;
    final kidPoint = point;
    final adult = parent;

    final ageSec = kidPoint?.ageSec ?? adult!.ageSec;
    final accuracy = accuracyText(kidPoint?.accuracy ?? adult?.accuracy);
    final battery = kidPoint?.batteryLevel ?? adult?.batteryLevel;
    final charging = kidPoint?.isCharging ?? adult?.isCharging;
    final stale = ageSec > kStalePointSec;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 8, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (kid != null)
                KidAvatar(child: kid, size: 52)
              else
                ParentAvatar(parent: adult!, size: 52),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      kid?.name ?? parentTitle(adult!),
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      placeAge(ageSec),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: stale ? scheme.onSurfaceVariant : AppColors.online,
                      ),
                    ),
                    if (accuracy != null || battery != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Row(
                          children: [
                            if (accuracy != null)
                              Text(
                                accuracy,
                                style: theme.textTheme.bodySmall
                                    ?.copyWith(color: scheme.onSurfaceVariant),
                              ),
                            if (accuracy != null && battery != null)
                              const SizedBox(width: 10),
                            BatteryBadge(level: battery, charging: charging),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Ко всем',
                icon: const Icon(Icons.close),
                onPressed: onClose,
              ),
            ],
          ),
          if (stale)
            Padding(
              padding: const EdgeInsets.only(top: 10, right: 12),
              child: Text(
                'Точка давно не обновлялась — телефон мог потерять связь или выключиться.',
                style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ),
          if (kid != null) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: () => openChild(context, kid),
                  icon: const Icon(Icons.person_outline),
                  label: const Text('Открыть'),
                ),
                OutlinedButton.icon(
                  onPressed: () => openChild(context, kid, 'history'),
                  icon: const Icon(Icons.timeline),
                  label: const Text('История'),
                ),
                OutlinedButton.icon(
                  onPressed: () => openChild(context, kid, 'audio'),
                  icon: const Icon(Icons.hearing_outlined),
                  label: const Text('Звук вокруг'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
