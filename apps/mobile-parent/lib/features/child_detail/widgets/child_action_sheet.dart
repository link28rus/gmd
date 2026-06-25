import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_exception.dart';
import '../../children/child_models.dart';
import '../../children/children_providers.dart';
import 'child_status_card.dart';

/// Собственно содержимое DraggableScrollableSheet — порт `_BottomPanel`.
///
/// В свернутом состоянии видна только верхняя часть до первого Divider'а
/// (handle + ChildStatusCard). При свайпе вверх раскрываются 7 действий.
///
/// Этап 1 редизайна: 2 живых action'а (Сигнал, Звук), 5 stub'ов snackbar
/// для будущих этапов 2-6.
class ChildActionSheet extends ConsumerStatefulWidget {
  const ChildActionSheet({
    super.key,
    required this.child,
    required this.latest,
    required this.scrollController,
  });

  final Child child;
  final ChildLocation? latest;
  final ScrollController scrollController;

  @override
  ConsumerState<ChildActionSheet> createState() => _ChildActionSheetState();
}

class _ChildActionSheetState extends ConsumerState<ChildActionSheet> {
  bool _signalSending = false;
  bool _protectionToggling = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      // Один ListView для всего содержимого — это требование
      // DraggableScrollableSheet: scrollController должен управлять единственным
      // scrollable child'ом, иначе sheet не отвечает на drag в expanded state.
      child: ListView(
        controller: widget.scrollController,
        padding: EdgeInsets.zero,
        children: [
          // Drag-handle. Декоративный — DraggableScrollableSheet ловит жесты
          // по всей поверхности ListView.
          const SizedBox(height: 8),
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: theme.colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 8),
          // Always-visible: статус-карточка
          ChildStatusCard(
            childName: widget.child.name,
            latest: widget.latest,
          ),
          const Divider(height: 24),
          // Action tiles
          _ActionTile(
            icon: Icons.timeline_outlined,
            label: 'История передвижений',
            onTap: () => _showSnack('История передвижений — скоро'),
          ),
          _ActionTile(
            icon: Icons.shield_outlined,
            label: 'Родительский контроль',
            onTap: _onParentalControl,
          ),
          _ActionTile(
            icon: Icons.lock_outline,
            label: 'Защита от удаления',
            trailing: _protectionToggling
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: Padding(
                      padding: EdgeInsets.all(4),
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : Switch(
                    value: widget.child.protectionEnabled,
                    // disabled когда у ребёнка нет привязанного устройства —
                    // переключать флаг без device бессмысленно (нечего защищать).
                    onChanged: widget.child.device == null
                        ? null
                        : (next) => _onProtectionToggle(next),
                  ),
            onTap: null,
          ),
          _ActionTile(
            icon: Icons.notifications_active_outlined,
            label: 'Отправить сигнал',
            busy: _signalSending,
            onTap: _signalSending ? null : _onSignalTap,
          ),
          _ActionTile(
            icon: Icons.hearing_outlined,
            label: 'Звук вокруг',
            onTap: _onListenAudio,
          ),
          _ActionTile(
            icon: Icons.link_off_outlined,
            label: 'Отвязать устройство',
            onTap: () => _showSnack('Отвязать устройство — скоро'),
          ),
          _ActionTile(
            icon: Icons.delete_outline,
            label: 'Удалить ребёнка',
            destructive: true,
            onTap: () => _showSnack('Удалить ребёнка — скоро'),
          ),
          // Безопасный padding снизу под жестовый/3-кнопочный системный bar
          SizedBox(height: MediaQuery.of(context).padding.bottom + 12),
        ],
      ),
    );
  }

  Future<void> _onProtectionToggle(bool next) async {
    final childName = widget.child.name;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(next ? 'Включить защиту от удаления?' : 'Отключить защиту?'),
        content: Text(
          next
              ? '$childName не сможет удалить или отключить приложение «Перископ Ребёнка» на '
                  'своём устройстве. Применится в течение нескольких секунд.'
              : '$childName сможет удалить приложение «Перископ Ребёнка» со своего устройства.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(next ? 'Включить' : 'Отключить'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _protectionToggling = true);
    try {
      await ref
          .read(childrenRepositoryProvider)
          .setProtection(widget.child.id, enabled: next);
      // childrenListProvider — источник истины для protectionEnabled
      // (`child.protectionEnabled` приходит в `GET /family/children`).
      // Invalidate чтобы Switch отобразил новое состояние.
      ref.invalidate(childrenListProvider);
      if (!mounted) return;
      _showSnack(next
          ? 'Защита от удаления включена'
          : 'Защита от удаления выключена');
    } on ApiException catch (e) {
      if (!mounted) return;
      _showSnack(e.message ?? 'Не удалось обновить защиту (код ${e.status})',
          error: true);
    } catch (e) {
      if (!mounted) return;
      _showSnack('Не удалось обновить защиту: $e', error: true);
    } finally {
      if (mounted) setState(() => _protectionToggling = false);
    }
  }

  void _onListenAudio() {
    final encoded = Uri.encodeQueryComponent(widget.child.name);
    context.push('/home/child/${widget.child.id}/audio?name=$encoded');
  }

  void _onParentalControl() {
    final encoded = Uri.encodeQueryComponent(widget.child.name);
    context.push(
      '/home/child/${widget.child.id}/parental-control?name=$encoded',
    );
  }

  Future<void> _onSignalTap() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Отправить сигнал?'),
        content: Text(
          '${widget.child.name} услышит громкую сирену даже если телефон '
          'на беззвучном. Используется чтобы найти телефон или привлечь '
          'внимание.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Отправить'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _signalSending = true);
    try {
      await ref.read(childrenRepositoryProvider).sendSignal(widget.child.id);
      if (!mounted) return;
      _showSnack('Сигнал отправлен — телефон должен зазвучать в течение нескольких секунд');
    } on ApiException catch (e) {
      if (!mounted) return;
      _showSnack(_signalErrorText(e), error: true);
    } catch (e) {
      if (!mounted) return;
      _showSnack('Не удалось отправить сигнал: $e', error: true);
    } finally {
      if (mounted) setState(() => _signalSending = false);
    }
  }

  String _signalErrorText(ApiException e) {
    if (e.isRateLimited) return 'Слишком частые сигналы. Подождите минуту.';
    switch (e.code) {
      case 'no_active_device':
        return 'У ребёнка нет активного устройства — приложение «Перископ Ребёнка» не установлено или удалено.';
      case 'child_not_found':
        return 'Ребёнок не найден.';
      case 'consent_required':
        return 'Сначала примите согласие на использование сервиса.';
      default:
        return e.message ?? 'Не удалось отправить сигнал (код ${e.status}).';
    }
  }

  void _showSnack(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: error ? Colors.red.shade700 : null,
      ),
    );
  }
}

/// Тайл одного действия: иконка + лейбл + опциональный trailing (Switch
/// или Chevron) + tap-handler. Если `busy=true` — вместо иконки спиннер.
class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.label,
    this.onTap,
    this.trailing,
    this.busy = false,
    this.destructive = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Widget? trailing;
  final bool busy;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final disabled = onTap == null && trailing == null;
    final color = destructive
        ? Colors.red.shade700
        : disabled
            ? theme.disabledColor
            : theme.colorScheme.onSurface;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            SizedBox(
              width: 24,
              height: 24,
              child: busy
                  ? Padding(
                      padding: const EdgeInsets.all(2),
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation(color),
                      ),
                    )
                  : Icon(icon, size: 24, color: color),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                label,
                style: theme.textTheme.bodyLarge?.copyWith(color: color),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (trailing != null)
              trailing!
            else if (onTap != null)
              Icon(
                Icons.chevron_right,
                size: 20,
                color: theme.colorScheme.onSurfaceVariant,
              ),
          ],
        ),
      ),
    );
  }
}
