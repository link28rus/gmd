import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/diag/diag_channel.dart';

// Скрытый диагностический экран — последние события фонового сервиса.
// Открывается долгим нажатием на версию в хедере home-экрана. Нужен чтобы
// снимать диагностику без ADB: пользователь делает скриншот — этого хватает.
class DebugScreen extends StatefulWidget {
  const DebugScreen({super.key});

  @override
  State<DebugScreen> createState() => _DebugScreenState();
}

class _DebugScreenState extends State<DebugScreen> {
  String _text = '';
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    final text = await diagRead();
    if (!mounted) return;
    setState(() {
      _text = text;
      _loading = false;
    });
  }

  Future<void> _clear() async {
    await diagClear();
    if (!mounted) return;
    await _refresh();
  }

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: _text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Скопировано')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final lines = _text.split('\n').where((l) => l.isNotEmpty).toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Диагностика'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Обновить',
            onPressed: _loading ? null : _refresh,
          ),
          IconButton(
            icon: const Icon(Icons.copy),
            tooltip: 'Скопировать',
            onPressed: lines.isEmpty ? null : _copy,
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Очистить',
            onPressed: lines.isEmpty ? null : _clear,
          ),
        ],
      ),
      body: lines.isEmpty
          ? const Center(child: Text('Лог пуст'))
          : ListView.separated(
              reverse: true,
              padding: const EdgeInsets.all(8),
              itemCount: lines.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final line = lines[lines.length - 1 - i];
                final isErr = line.contains('FAILED') || line.contains('Error');
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 4),
                  child: Text(
                    line,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: isErr ? Colors.red : Colors.black87,
                    ),
                  ),
                );
              },
            ),
    );
  }
}
