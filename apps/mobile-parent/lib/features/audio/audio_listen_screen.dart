import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../../core/config/env.dart';
import '../../core/providers.dart';

/// Экран «Звук вокруг ребёнка» (Phase B Step 4).
///
/// MVP-реализация: открываем embed-страницу `/embed/audio/<childId>` веб-кабинета
/// внутри WebView. Веб-плеер уже работает (Opus → AudioWorklet → MediaStream)
/// и протестирован, его поведение в WebView Chromium идентичное браузерному.
///
/// Auth-токен передаётся в URL через hash (`#t=...&n=...`) — hash не уезжает
/// в HTTP-запросы и не светится в access-логах. Сразу при mount embed-page
/// вычистит hash из адресной строки `history.replaceState`.
///
/// В будущем можно заменить на нативный декодер (MediaCodec/AVAudioEngine
/// + flutter_opus или собственный JNI-биндинг) — UI этого экрана не изменится.
class AudioListenScreen extends ConsumerStatefulWidget {
  const AudioListenScreen({
    super.key,
    required this.childId,
    required this.childName,
  });

  final String childId;
  final String childName;

  @override
  ConsumerState<AudioListenScreen> createState() => _AudioListenScreenState();
}

class _AudioListenScreenState extends ConsumerState<AudioListenScreen> {
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

    final url = _buildEmbedUrl(session.accessToken, session.user.id,
        session.user.email, session.family.id, session.family.name ?? '');

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Theme.of(context).colorScheme.surface)
      ..setOnConsoleMessage((msg) {
        // Все JS console.* в logcat, виден через `adb logcat | grep "Periscop-WV"`
        // (через flutter-print, чтобы работало и в release).
        debugPrint('Periscop-WV [${msg.level.name}] ${msg.message}');
      })
      ..addJavaScriptChannel(
        'PeriscopHost',
        onMessageReceived: (m) {
          debugPrint('Periscop-WV [bridge] ${m.message}');
          // Команда close — embed-page просит закрыть экран после
          // тапа «Закрыть» / «Остановить» в audio-сессии.
          if (m.message == 'close' && mounted) {
            Navigator.of(context).maybePop();
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
            // Перехватчик unhandled errors / promise-rejections — сразу шлём в Flutter.
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
            // Игнорируем мелкие ошибки subresources (favicon, метрики и т.п.) —
            // фейлим только если упал основной фрейм.
            if (err.isForMainFrame ?? false) {
              if (mounted) {
                setState(() {
                  _loadError = 'Не удалось открыть страницу: ${err.description}';
                  _loading = false;
                });
              }
            }
          },
        ),
      )
      ..loadRequest(Uri.parse(url));

    // Android: разрешаем autoplay аудио без user gesture — иначе AudioContext
    // resume() в embed-странице ждёт первого тапа, и поток молчит.
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
      'n': widget.childName,
      'u': userId,
      'e': email,
      'f': familyId,
      'fn': familyName,
    };
    final encoded = hash.entries
        .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
        .join('&');
    return '$webOrigin/embed/audio/${widget.childId}#$encoded';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Звук — ${widget.childName}'),
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
