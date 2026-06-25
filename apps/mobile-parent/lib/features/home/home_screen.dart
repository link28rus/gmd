import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/version/app_version.dart';
import '../children/child_models.dart';
import '../children/children_providers.dart';
import '../children/widgets/add_child_flow.dart';
import 'update_banner.dart';

/// Главный экран. Phase A: список детей + быстрые действия (placeholders).
/// Карта, геозоны, история, звук, app-control — последующие фазы.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final childrenAsync = ref.watch(childrenListProvider);
    final session = ref.watch(authSessionProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Мои дети'),
        actions: [
          // Версия + long-press → /debug. Аналог mobile-child header'а.
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Center(
              child: GestureDetector(
                onLongPress: () => context.push('/debug'),
                child: const AppVersionLabel(),
              ),
            ),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert),
            onSelected: (value) async {
              switch (value) {
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
              const PopupMenuItem<String>(value: 'logout', child: Text('Выйти')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          // Auto-update: показывается ТОЛЬКО когда есть обновление
          // (Downloading / Downloaded / NeedsPermission / Failed).
          const UpdateBanner(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async => ref.invalidate(childrenListProvider),
              child: childrenAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => _ErrorView(
                  error: e,
                  onRetry: () => ref.invalidate(childrenListProvider),
                ),
                data: (children) => children.isEmpty
                    ? const _EmptyState()
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

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 48),
        Icon(Icons.family_restroom_outlined,
            size: 96, color: Colors.grey.shade400),
        const SizedBox(height: 16),
        const Text(
          'Пока нет детей',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Text(
          'Добавьте первого ребёнка по QR-коду — на телефоне ребёнка установите '
          'приложение «Перископ Ребёнка» и отсканируйте QR из этого приложения.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.grey.shade700),
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
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 48),
        Icon(Icons.cloud_off_outlined, size: 64, color: Colors.grey.shade500),
        const SizedBox(height: 16),
        const Text(
          'Не удалось загрузить детей',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Text(
          error.toString(),
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
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
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: children.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (_, i) => _ChildCard(child: children[i]),
    );
  }
}

class _ChildCard extends StatelessWidget {
  const _ChildCard({required this.child});

  final Child child;

  @override
  Widget build(BuildContext context) {
    final initials = child.name.isNotEmpty
        ? child.name.trim().split(' ').take(2).map((s) => s.characters.first).join()
        : '?';
    final online = child.isOnline;

    return Card(
      elevation: 0,
      child: ListTile(
        leading: CircleAvatar(
          radius: 24,
          backgroundColor: online ? Colors.green.shade100 : Colors.grey.shade200,
          child: Text(
            initials.toUpperCase(),
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: online ? Colors.green.shade800 : Colors.grey.shade700,
            ),
          ),
        ),
        title: Text(child.name,
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(_subtitle(child)),
        trailing: const Icon(Icons.chevron_right),
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
