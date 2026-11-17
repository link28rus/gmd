import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/providers.dart';
import '../permission_state.dart';

final permissionStateProvider = FutureProvider.autoDispose
    .family<PermissionState, String>((ref, id) async {
      final r = await ref
          .watch(dioProvider)
          .get<Map<String, dynamic>>('/family/children/$id/permission-state');
      return PermissionState.fromJson(r.data ?? {});
    });

class PermissionStateCard extends ConsumerStatefulWidget {
  const PermissionStateCard({super.key, required this.childId});
  final String childId;
  @override
  ConsumerState<PermissionStateCard> createState() =>
      _PermissionStateCardState();
}

class _PermissionStateCardState extends ConsumerState<PermissionStateCard>
    with WidgetsBindingObserver {
  Timer? _poll;
  bool _busy = false;
  String? _message;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(const Duration(seconds: 15), (_) {
      if (WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) {
        ref.invalidate(permissionStateProvider(widget.childId));
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ref.invalidate(permissionStateProvider(widget.childId));
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final r = await ref
          .read(dioProvider)
          .post<Map<String, dynamic>>(
            '/family/children/${widget.childId}/refresh-permission-state',
          );
      if (!mounted) return;
      setState(() {
        _message = r.data?['requested'] == true
            ? 'Запрос отправлен. Ожидаем отчёт телефона.'
            : 'Телефон недоступен. Отчёт появится после выхода на связь.';
      });
      ref.invalidate(permissionStateProvider(widget.childId));
    } catch (_) {
      if (mounted) {
        setState(() {
          _message = 'Не удалось отправить запрос. Повторите позже.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(permissionStateProvider(widget.childId));
    final data = state.valueOrNull;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            data?.summary ??
                (state.hasError
                    ? 'Не удалось проверить разрешения'
                    : 'Проверяем разрешения…'),
            style: TextStyle(
              color: data?.needsAttention == true
                  ? Theme.of(context).colorScheme.error
                  : null,
            ),
          ),
          if (data?.reportedAt != null)
            Text(
              'Проверено: ${data!.reportedAt!.toLocal()}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          if (data?.isStale == true && data!.missing.isNotEmpty)
            Text('В последнем отчёте отключено: ${data.missing.join(', ')}'),
          if (data?.status == 'unknown')
            const Text('Откройте обновлённое приложение на телефоне ребёнка.'),
          TextButton(
            onPressed: _busy ? null : _refresh,
            child: Text(_busy ? 'Отправляем…' : 'Проверить сейчас'),
          ),
          if (_message != null)
            Text(_message!, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}
