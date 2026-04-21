import 'package:flutter/foundation.dart';

// Release-build (APK на реальном телефоне) ходит на prod через HTTPS-домен.
// Caddy: `handle_path /api/* → backend:3001` стрипает префикс, поэтому baseUrl с `/api`.
// Dev-build (flutter run на эмуляторе) ходит на хост-машину через loopback.
// Переопределить можно через `--dart-define=API_BASE_URL=...`.
const _fallbackApiBaseUrl = kReleaseMode
    ? 'https://gmd.link28rus.ru/api'
    : 'http://10.0.2.2:3001';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: _fallbackApiBaseUrl,
);
