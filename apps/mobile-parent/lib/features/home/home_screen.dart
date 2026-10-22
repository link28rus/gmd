import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../core/providers.dart';
import '../../core/theme/theme_mode_provider.dart';
import '../../core/version/app_version.dart';
import '../children/child_models.dart';
import '../children/children_providers.dart';
import '../children/widgets/add_child_flow.dart';
import '../map/family_map.dart';
import '../zones/zone_models.dart';
import '../zones/zones_providers.dart';
import 'family_sheet.dart';
import 'home_family_map.dart';
import 'share_location_card.dart';
import 'update_banner.dart';

/// Главный экран. v0.86.0 — как пункт «Все» в кабинете и как в Life360 /
/// «Локаторе»: общая карта семьи на весь экран (дети, взрослые, зоны, см.
/// [HomeFamilyMap]), снизу шторка со списком «Дети» / «Взрослые».
/// Нажатие на метку или строку — карта летит к человеку, в шторке его
/// карточка (давность, точность, заряд; у ребёнка — «Открыть», «История»,
/// «Звук вокруг»). «Назад», крестик, пустое место карты или «Показать всех»
/// возвращают список. Карточка «Местоположение этого телефона» — в начале
/// списка, пока для фоновой передачи чего-то не хватает (v0.73.0).
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  // Доли высоты под шторку: свёрнута (виден заголовок), середина (по
  // умолчанию и под карточку), развёрнута.
  static const _sheetMin = 0.14;
  static const _sheetMid = 0.42;
  static const _sheetMax = 0.92;

  final _map = FamilyMapController();
  final _sheet = DraggableScrollableController();

  /// Выбранная метка ([kidMarkerKey] / [parentMarkerKey]) или null — список.
  String? _selected;

  /// Высота области под картой и шторкой (из LayoutBuilder).
  double _bodyHeight = 0;

  @override
  void dispose() {
    _sheet.dispose();
    super.dispose();
  }

  double get _sheetPx => (_sheet.isAttached ? _sheet.size : _sheetMid) * _bodyHeight;

  /// Поля для «Показать всех»: метки шире точки (подпись ~96 px, веер ещё
  /// ~60 px в сторону) и выше неё; справа — кнопки карты, снизу — шторка.
  EdgeInsets _fitPadding() => EdgeInsets.fromLTRB(80, 88, 96, _sheetPx + 24);

  void _select(String key, LatLng point) {
    setState(() => _selected = key);
    if (_sheet.isAttached && (_sheet.size - _sheetMid).abs() > 0.01) {
      _sheet.animateTo(
        _sheetMid,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
      );
    }
    // Точка — посередине видимой над шторкой части карты.
    _map.focus(point, offset: Offset(0, -_sheetMid * _bodyHeight / 2));
  }

  void _clearSelection() {
    if (_selected != null) setState(() => _selected = null);
  }

  Future<void> _refreshAll() async {
    ref.invalidate(childrenListProvider);
    ref.invalidate(familyLatestProvider);
    ref.invalidate(zonesListProvider);
    try {
      await ref.read(childrenListProvider.future);
    } catch (_) {
      // ошибку покажет сам список
    }
  }

  @override
  Widget build(BuildContext context) {
    final latest = ref.watch(familyLatestProvider).valueOrNull ?? FamilyLatest.empty;
    final kids = ref.watch(childrenListProvider).valueOrNull ?? const <Child>[];
    final pointByKid = {for (final p in latest.items) p.childId: p};
    // Выбранный пропал (удалён, точка исчезла, скрылся от семьи) — показываем
    // список и не держим «Назад».
    final sel = _selected;
    final selected = sel != null &&
            (kids.any((k) => sel == kidMarkerKey(k.id) && pointByKid.containsKey(k.id)) ||
                latest.parents.any((p) => sel == parentMarkerKey(p.userId)))
        ? sel
        : null;

    void selectKid(Child kid) {
      final p = pointByKid[kid.id];
      if (p != null) _select(kidMarkerKey(kid.id), LatLng(p.lat, p.lon));
    }

    void selectParent(FamilyLatestParent p) =>
        _select(parentMarkerKey(p.userId), LatLng(p.lat, p.lon));

    return PopScope(
      // «Назад» при открытой карточке — к списку, а не выход из приложения.
      canPop: selected == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _clearSelection();
      },
      child: Scaffold(
        appBar: _buildAppBar(context),
        body: Column(
          children: [
            // v0.56.0 самообновление: виден только при загрузке, готовом
            // обновлении, ожидании подтверждения или сбое загрузки/установки.
            const UpdateBanner(),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  _bodyHeight = constraints.maxHeight;
                  return Stack(
                    children: [
                      Positioned.fill(
                        child: HomeFamilyMap(
                          controller: _map,
                          selectedKey: selected,
                          fitPadding: _fitPadding,
                          onKidTap: selectKid,
                          onParentTap: selectParent,
                          onMapTap: _clearSelection,
                          onFitAll: _clearSelection,
                        ),
                      ),
                      DraggableScrollableSheet(
                        controller: _sheet,
                        initialChildSize: _sheetMid,
                        minChildSize: _sheetMin,
                        maxChildSize: _sheetMax,
                        snap: true,
                        snapSizes: const [_sheetMid],
                        builder: (context, scroll) => _SheetBody(
                          scroll: scroll,
                          selected: selected,
                          latest: latest,
                          pointByKid: pointByKid,
                          kids: kids,
                          onSelectKid: selectKid,
                          onSelectParent: selectParent,
                          onClose: _clearSelection,
                          onRefresh: _refreshAll,
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(BuildContext context) {
    final session = ref.watch(authSessionProvider);
    final sharing = ref.watch(parentLocationProvider);
    return AppBar(
      title: const Text('Моя семья'),
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
              case 'profile':
                await context.push('/home/profile');
                break;
              case 'family':
                await context.push('/home/family');
                break;
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
            // v0.76.0: имя и email — вход в профиль (ФИО).
            PopupMenuItem<String>(
              value: 'profile',
              child: Row(
                children: [
                  const Icon(Icons.person_outline, size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          (session?.user.name?.trim().isNotEmpty ?? false)
                              ? session!.user.name!.trim()
                              : 'Профиль',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          session?.user.email ?? '',
                          style: Theme.of(context).textTheme.bodySmall,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const PopupMenuDivider(),
            // v0.71.0: участники семьи, приглашение взрослых.
            const PopupMenuItem<String>(
              value: 'family',
              child: Row(
                children: [
                  Icon(Icons.family_restroom_outlined, size: 20),
                  SizedBox(width: 12),
                  Text('Семья'),
                ],
              ),
            ),
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
                // v0.73.0: пояснение — точки собираются при любом положении.
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Показывать меня семье'),
                    const SizedBox(height: 2),
                    Text(
                      'Вам телефон всё равно виден в «Найти телефон»',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
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
    );
  }
}

/// Шторка: ручка, затем карточка выбранного человека или список семьи.
class _SheetBody extends ConsumerWidget {
  const _SheetBody({
    required this.scroll,
    required this.selected,
    required this.latest,
    required this.pointByKid,
    required this.kids,
    required this.onSelectKid,
    required this.onSelectParent,
    required this.onClose,
    required this.onRefresh,
  });

  final ScrollController scroll;
  final String? selected;
  final FamilyLatest latest;
  final Map<String, FamilyLatestPoint> pointByKid;
  final List<Child> kids;
  final void Function(Child kid) onSelectKid;
  final void Function(FamilyLatestParent parent) onSelectParent;
  final VoidCallback onClose;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final childrenAsync = ref.watch(childrenListProvider);

    Widget? card;
    final sel = selected;
    if (sel != null) {
      for (final k in kids) {
        final p = pointByKid[k.id];
        if (sel == kidMarkerKey(k.id) && p != null) {
          card = MemberCard.kid(child: k, point: p, onClose: onClose);
        }
      }
      for (final p in latest.parents) {
        if (sel == parentMarkerKey(p.userId)) {
          card = MemberCard.parent(parent: p, onClose: onClose);
        }
      }
    }

    final List<Widget> items;
    if (card != null) {
      items = [card];
    } else {
      items = childrenAsync.when(
        loading: () => const [
          ShareLocationCardPadded(),
          Padding(
            padding: EdgeInsets.all(32),
            child: Center(child: CircularProgressIndicator()),
          ),
        ],
        error: (e, _) => [_ErrorView(error: e, onRetry: onRefresh)],
        data: (children) => children.isEmpty
            ? [_EmptyState(onAddChild: () => startAddChildFlow(context, ref))]
            : [
                const ShareLocationCardPadded(),
                const SheetSectionTitle('Дети'),
                for (final c in children)
                  KidSheetRow(
                    child: c,
                    point: pointByKid[c.id],
                    onSelect: () => onSelectKid(c),
                  ),
                if (latest.parents.isNotEmpty) ...[
                  const SheetSectionTitle('Взрослые'),
                  for (final p in latest.parents)
                    ParentSheetRow(parent: p, onSelect: () => onSelectParent(p)),
                ],
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.person_add_alt_1),
                    label: const Text('Добавить ребёнка'),
                    onPressed: () => startAddChildFlow(context, ref),
                  ),
                ),
              ],
      );
    }

    return Material(
      color: scheme.surface,
      elevation: 8,
      shadowColor: Colors.black54,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      clipBehavior: Clip.antiAlias,
      child: RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          controller: scroll,
          padding: EdgeInsets.only(bottom: MediaQuery.paddingOf(context).bottom),
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 10, bottom: 8),
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            ...items,
          ],
        ),
      ),
    );
  }
}

/// [ShareLocationCard] с отступами шторки (пустая, когда всё выдано).
class ShareLocationCardPadded extends StatelessWidget {
  const ShareLocationCardPadded({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(horizontal: 16),
        child: ShareLocationCard(),
      );
}

/// Тумблер «Показывать меня семье»: PUT /parent-location/sharing — только
/// видимость семье. v0.73.0: служба и сбор точек работают при любом
/// положении (нужны «Найти телефон»), точки с сервера не удаляются.
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
            : 'Семья больше не видит, где вы. Местоположение по-прежнему '
                'сохраняется для «Найти телефон».'),
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
      child: Column(
        children: [
          const ShareLocationCard(),
          const SizedBox(height: 16),
          Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.family_restroom_outlined,
              size: 48,
              color: scheme.onPrimaryContainer,
            ),
          ),
          const SizedBox(height: 20),
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
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: onAddChild,
            icon: const Icon(Icons.person_add_alt_1),
            label: const Text('Добавить ребёнка'),
          ),
        ],
      ),
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
      child: Column(
        children: [
          const ShareLocationCard(),
          const SizedBox(height: 16),
          Icon(Icons.cloud_off_outlined, size: 56, color: scheme.onSurfaceVariant),
          const SizedBox(height: 12),
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
          FilledButton.tonal(
            onPressed: onRetry,
            child: const Text('Повторить'),
          ),
        ],
      ),
    );
  }
}
