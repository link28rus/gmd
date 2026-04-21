import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

class AppVersionLabel extends StatefulWidget {
  const AppVersionLabel({super.key, this.style});

  final TextStyle? style;

  @override
  State<AppVersionLabel> createState() => _AppVersionLabelState();
}

class _AppVersionLabelState extends State<AppVersionLabel> {
  String _version = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final info = await PackageInfo.fromPlatform();
      if (!mounted) return;
      setState(() {
        _version = info.buildNumber.isEmpty
            ? 'v${info.version}'
            : 'v${info.version} (${info.buildNumber})';
      });
    } catch (_) {
      // Платформенные каналы недоступны (widget-тесты) — молча ничего
      // не показываем, чем показывать stacktrace.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Text(
      _version,
      style: widget.style ??
          TextStyle(
            fontSize: 11,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
    );
  }
}
