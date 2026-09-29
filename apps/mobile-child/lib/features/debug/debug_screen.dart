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
  // v0.60.0: настройки журнала на сервере (одной строкой).
  String _config = '';
  bool _loading = false;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    final text = await diagRead();
    final config = await diagConfigSummary();
    if (!mounted) return;
    setState(() {
      _text = text;
      _config = config;
      _loading = false;
    });
  }

  // v0.60.0: ручная отправка журнала на сервер (WorkManager, ждёт сеть).
  Future<void> _upload() async {
    setState(() => _uploading = true);
    final ok = await diagUpload(reason: 'manual');
    if (!mounted) return;
    setState(() => _uploading = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          ok
              ? 'Журнал поставлен в отправку — уйдёт, когда будет интернет'
              : 'Не удалось поставить журнал в отправку',
        ),
      ),
    );
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
            icon: const Icon(Icons.cloud_upload_outlined),
            tooltip: 'Отправить журнал',
            onPressed: _uploading ? null : _upload,
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
      body: Column(
        children: [
          if (_config.isNotEmpty)
            Container(
              width: double.infinity,
              color: Colors.black.withValues(alpha: 0.05),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Text(
                'Журнал: $_config',
                style: const TextStyle(fontSize: 11, color: Colors.black54),
              ),
            ),
          Expanded(child: _buildLog(lines)),
        ],
      ),
    );
  }

  Widget _buildLog(List<String> lines) {
    return lines.isEmpty
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
          );
  }
}
