import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../../core/config/env.dart';
import '../../core/providers.dart';

/// Экран «Родительский контроль» (этап 6 редизайна child-detail, v0.50.0).
///
/// MVP — открываем embed-страницу `/embed/parental-control/<childId>` веб-кабинета
/// в WebView. UI большой и сложный (usage chart + категории + 3-state app rules
/// + BlockDialog с Radix Dialog) — native-порт займёт 3–5 дней. Embed = 0.5 дня
/// при том же UX (паттерн уже отлажен на «Звуке вокруг»).
///
/// Auth-токен передаётся в URL через hash (`#t=...&u=...&e=...&f=...&fn=...`)
/// чтобы он не уезжал в access-логи Caddy. embed-page сразу при mount
/// очищает hash через `history.replaceState`.
///
/// JS-bridge `PeriscopHost.postMessage('close')` закрывает экран при тапе кнопки
/// «Назад» в embed-странице.
class ParentalControlScreen extends ConsumerStatefulWidget {
  const ParentalControlScreen({
    super.key,
    required this.childId,
    required this.childName,
  });

  final String childId;
  final String childName;

  @override
  ConsumerState<ParentalControlScreen> createState() =>
      _ParentalControlScreenState();
}

class _ParentalControlScreenState extends ConsumerState<ParentalControlScreen> {
  late final WebViewController _controller;
  bool _loading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    final session = ref.read(authSessionProvider);
    if (session == null) {
      _loadError = 'Сессия истекла, войдите заново.';
      _controller = WebViewController();
      return;
    }

    final url = _buildEmbedUrl(
      session.accessToken,
      session.user.id,
      session.user.email,
      session.family.id,
      session.family.name ?? '',
    );

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Theme.of(context).colorScheme.surface)
      ..setOnConsoleMessage((msg) {
        debugPrint('Periscop-WV [${msg.level.name}] ${msg.message}');
      })
      ..addJavaScriptChannel(
        'PeriscopHost',
        onMessageReceived: (m) {
          debugPrint('Periscop-WV [bridge] ${m.message}');
          if (m.message == 'close' && mounted) {
            Navigator.of(context).maybePop();
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
            // Перехватчик unhandled errors / promise-rejections — сразу
            // в Flutter, чтобы видеть их в logcat вместе с обычными console.*.
            _controller.runJavaScript('''
              (function () {
                if (window.__periscopErrHooked) return;
                window.__periscopErrHooked = true;
                window.addEventListener('error', function (e) {
                  try {
                    PeriscopHost.postMessage('window.error: ' + (e.error ? (e.error.stack || e.error.message) : e.message));
                  } catch (_) {}
                });
                window.addEventListener('unhandledrejection', function (e) {
                  try {
                    var r = e.reason;
                    PeriscopHost.postMessage('unhandledrejection: ' + (r && (r.stack || r.message) ? (r.stack || r.message) : String(r)));
                  } catch (_) {}
                });
              })();
            ''');
          },
          onWebResourceError: (err) {
            debugPrint(
              'Periscop-WV resource error mainFrame=${err.isForMainFrame} '
              'code=${err.errorCode} type=${err.errorType} desc=${err.description}',
            );
            if (err.isForMainFrame ?? false) {
              if (mounted) {
                setState(() {
                  _loadError =
                      'Не удалось открыть страницу: ${err.description}';
                  _loading = false;
                });
              }
            }
          },
        ),
      )
      ..loadRequest(Uri.parse(url));

    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
  }

  String _buildEmbedUrl(
    String accessToken,
    String userId,
    String email,
    String familyId,
    String familyName,
  ) {
    final hash = <String, String>{
      't': accessToken,
      'u': userId,
      'e': email,
      'f': familyId,
      'fn': familyName,
    };
    final encoded = hash.entries
        .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
        .join('&');
    return '$webOrigin/embed/parental-control/${widget.childId}#$encoded';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Контроль — ${widget.childName}'),
      ),
      body: SafeArea(
        child: Stack(
          children: [
            if (_loadError == null) WebViewWidget(controller: _controller),
            if (_loading && _loadError == null)
              const Center(child: CircularProgressIndicator()),
            if (_loadError != null)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Center(
                  child: Text(
                    _loadError!,
                    style: TextStyle(color: Colors.red.shade800),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
