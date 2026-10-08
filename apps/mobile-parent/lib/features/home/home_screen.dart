import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/theme_mode_provider.dart';
import '../../core/version/app_version.dart';
import '../children/child_models.dart';
import '../children/children_providers.dart';
import '../children/widgets/add_child_flow.dart';
import '../children/widgets/child_avatar.dart';
import '../zones/zones_providers.dart';
import 'home_family_map.dart';
import 'share_location_card.dart';
import 'update_banner.dart';

/// Главный экран. v0.70.0: сверху общая карта семьи (дети, родители, зоны —
/// только просмотр, см. [HomeFamilyMap]), ниже список детей и карточка
/// «Показывать вас семье», пока для фоновой передачи чего-то не хватает.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final childrenAsync = ref.watch(childrenListProvider);
    final session = ref.watch(authSessionProvider);
    final sharing = ref.watch(parentLocationProvider);
    final mapHeight = math.max(220.0, MediaQuery.of(context).size.height * 0.45);

    Future<void> refreshAll() async {
      ref.invalidate(childrenListProvider);
      ref.invalidate(familyLatestProvider);
      ref.invalidate(zonesListProvider);
      try {
        await ref.read(childrenListProvider.future);
      } catch (_) {
        // ошибку покажет сам список
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Мои дети'),
        actions: [
          // v0.66.0: геозоны семьи.
          IconButton(
            tooltip: 'Геозоны',
            icon: const Icon(Icons.share_location_outlined),
            onPressed: () => context.push('/home/zones'),
          ),
          // Версия: нажатие — проверить обновления, long-press — /debug.
          // Аналог mobile-child header'а.
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => checkForUpdates(context, ref),
            onLongPress: () => context.push('/debug'),
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 8),
              child: Center(child: AppVersionLabel()),
            ),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert),
            onSelected: (value) async {
              switch (value) {
                case 'theme':
                  await _showThemeDialog(context, ref);
                  break;
                case 'updates':
                  await checkForUpdates(context, ref);
                  break;
                case 'share':
                  await _toggleSharing(context, ref);
                  break;
                case 'logout':
                  await ref.read(authRepositoryProvider).logout();
                  ref.read(authSessionProvider.notifier).state = null;
                  if (context.mounted) context.go('/login');
                  break;
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem<String>(
                value: 'profile',
                enabled: false,
                child: Text(
                  session?.user.email ?? '',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              const PopupMenuDivider(),
              const PopupMenuItem<String>(
                value: 'theme',
                child: Row(
                  children: [
                    Icon(Icons.brightness_6_outlined, size: 20),
                    SizedBox(width: 12),
                    Text('Тема оформления'),
                  ],
                ),
              ),
              // v0.70.0: фоновая геолокация родителя — только Android.
              if (Platform.isAndroid)
                CheckedPopupMenuItem<String>(
                  value: 'share',
                  checked: sharing.enabled == true,
                  enabled: sharing.enabled != null && !sharing.busy,
                  child: const Text('Показывать меня семье'),
                ),
              // Самообновление есть только на Android (iOS — через App Store).
              if (Platform.isAndroid)
                const PopupMenuItem<String>(
                  value: 'updates',
                  child: Row(
                    children: [
                      Icon(Icons.system_update_outlined, size: 20),
                      SizedBox(width: 12),
                      Text('Проверить обновления'),
                    ],
                  ),
                ),
              const PopupMenuItem<String>(value: 'logout', child: Text('Выйти')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          // v0.56.0 самообновление: виден только при загрузке, готовом
          // обновлении, ожидании подтверждения или сбое загрузки/установки.
          const UpdateBanner(),
          // v0.70.0: общая карта семьи; refresh списка обновляет и её.
          SizedBox(height: mapHeight, child: const HomeFamilyMap()),
          Expanded(
            child: RefreshIndicator(
              onRefresh: refreshAll,
              child: childrenAsync.when(
                loading: () => ListView(
                  children: const [
                    Padding(
                      padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
                      child: ShareLocationCard(),
                    ),
                    SizedBox(height: 32),
                    Center(child: CircularProgressIndicator()),
                  ],
                ),
                error: (e, _) => _ErrorView(
                  error: e,
                  onRetry: refreshAll,
                ),
                data: (children) => children.isEmpty
                    ? _EmptyState(
                        onAddChild: () => startAddChildFlow(context, ref),
                      )
                    : _ChildrenList(children: children),
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Добавить ребёнка'),
        onPressed: () => startAddChildFlow(context, ref),
      ),
    );
  }
}

/// Тумблер «Показывать меня семье»: PUT /parent-location/sharing + старт или
/// стоп службы. Выключение заодно удаляет точки родителя с сервера.
Future<void> _toggleSharing(BuildContext context, WidgetRef ref) async {
  final messenger = ScaffoldMessenger.of(context);
  final next = ref.read(parentLocationProvider).enabled != true;
  try {
    await ref.read(parentLocationProvider.notifier).setSharing(next);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(next
            ? 'Семья видит, где вы.'
            : 'Семья больше не видит, где вы. Ваши точки удалены с сервера.'),
      ));
  } catch (_) {
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(
        content: Text('Не удалось переключить — проверьте интернет.'),
      ));
  }
}

/// Диалог выбора темы (Как в системе / Светлая / Тёмная). Сохраняется в
/// SharedPreferences через [themeModeProvider].
Future<void> _showThemeDialog(BuildContext context, WidgetRef ref) async {
  final current = ref.read(themeModeProvider);
  final selected = await showDialog<ThemeMode>(
    context: context,
    builder: (ctx) => SimpleDialog(
      title: const Text('Тема оформления'),
      children: [
        _themeOption(ctx, current, ThemeMode.system, 'Как в системе',
            Icons.brightness_auto_outlined),
        _themeOption(ctx, current, ThemeMode.light, 'Светлая',
            Icons.light_mode_outlined),
        _themeOption(ctx, current, ThemeMode.dark, 'Тёмная',
            Icons.dark_mode_outlined),
      ],
    ),
  );
  if (selected != null) {
    await ref.read(themeModeProvider.notifier).setMode(selected);
  }
}

Widget _themeOption(
  BuildContext ctx,
  ThemeMode current,
  ThemeMode value,
  String label,
  IconData icon,
) {
  final scheme = Theme.of(ctx).colorScheme;
  final selected = current == value;
  return ListTile(
    leading: Icon(icon),
    title: Text(label),
    trailing: selected ? Icon(Icons.check, color: scheme.primary) : null,
    onTap: () => Navigator.of(ctx).pop(value),
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onAddChild});

  final VoidCallback onAddChild;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const ShareLocationCard(),
        const SizedBox(height: 48),
        Center(
          child: Container(
            width: 120,
            height: 120,
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.family_restroom_outlined,
              size: 56,
              color: scheme.onPrimaryContainer,
            ),
          ),
        ),
        const SizedBox(height: 24),
        Text(
          'Пока нет детей',
          textAlign: TextAlign.center,
          style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Text(
          'Добавьте первого ребёнка по QR-коду — на телефоне ребёнка установите '
          'приложение «Перископ Ребёнка» и отсканируйте QR из этого приложения.',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 24),
        Center(
          child: FilledButton.icon(
            onPressed: onAddChild,
            icon: const Icon(Icons.person_add_alt_1),
            label: const Text('Добавить ребёнка'),
          ),
        ),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const ShareLocationCard(),
        const SizedBox(height: 48),
        Icon(Icons.cloud_off_outlined, size: 64, color: scheme.onSurfaceVariant),
        const SizedBox(height: 16),
        Text(
          'Не удалось загрузить детей',
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Text(
          error.toString(),
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 16),
        Center(
          child: FilledButton.tonal(
            onPressed: onRetry,
            child: const Text('Повторить'),
          ),
        ),
      ],
    );
  }
}

class _ChildrenList extends StatelessWidget {
  const _ChildrenList({required this.children});

  final List<Child> children;

  @override
  Widget build(BuildContext context) {
    // Первый элемент — карточка «Показывать вас семье» (пустая, когда всё
    // выдано); у неё свой нижний отступ.
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: children.length + 1,
      separatorBuilder: (_, i) => SizedBox(height: i == 0 ? 0 : 12),
      itemBuilder: (_, i) =>
          i == 0 ? const ShareLocationCard() : _ChildCard(child: children[i - 1]),
    );
  }
}

class _ChildCard extends StatelessWidget {
  const _ChildCard({required this.child});

  final Child child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final initials = child.name.isNotEmpty
        ? child.name.trim().split(' ').take(2).map((s) => s.characters.first).join()
        : '?';
    final online = child.isOnline;
    final avatarBg =
        online ? scheme.primaryContainer : scheme.surfaceContainerHighest;
    final avatarFg = online ? scheme.onPrimaryContainer : scheme.onSurfaceVariant;

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: SizedBox(
          width: 48,
          height: 48,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              ChildAvatar(
                name: child.name,
                childId: child.id,
                avatarKey: child.avatarKey,
                size: 48,
                // Буква — как до аватаров: фон зависит от online-статуса.
                fallback: (_) => CircleAvatar(
                  radius: 24,
                  backgroundColor: avatarBg,
                  child: Text(
                    initials.toUpperCase(),
                    style: TextStyle(fontWeight: FontWeight.w600, color: avatarFg),
                  ),
                ),
              ),
              // Явный online-индикатор — зелёная точка поверх аватара, не
              // только оттенок фона (виден и на зелёном primaryContainer).
              if (online)
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: Container(
                    width: 14,
                    height: 14,
                    decoration: BoxDecoration(
                      color: AppColors.online,
                      shape: BoxShape.circle,
                      border: Border.all(color: scheme.surface, width: 2),
                    ),
                  ),
                ),
            ],
          ),
        ),
        title: Text(child.name,
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(
          _subtitle(child),
          style: theme.textTheme.bodyMedium?.copyWith(
            color: online ? AppColors.online : scheme.onSurfaceVariant,
            fontWeight: online ? FontWeight.w500 : FontWeight.w400,
          ),
        ),
        trailing: Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
        onTap: () {
          GoRouter.of(context).push('/home/child/${child.id}');
        },
      ),
    );
  }

  String _subtitle(Child child) {
    final d = child.device;
    if (d == null) return 'Устройство ещё не подключено';
    if (d.revokedAt != null) return 'Доступ отозван';
    final last = d.lastSeenAt;
    if (last == null) return 'Ещё не выходил на связь';
    final diff = DateTime.now().difference(last);
    if (diff.inMinutes < 2) return 'Онлайн — только что';
    if (diff.inMinutes < 60) return 'Онлайн ${diff.inMinutes} мин назад';
    if (diff.inHours < 24) return 'Был ${diff.inHours} ч назад';
    return 'Был ${diff.inDays} д назад';
  }
}
