// Дефолт — prod, чтобы debug-APK на реальном устройстве сразу ходил в боевой
// API. Для разработки на эмуляторе/Genymotion передавать loopback явно через
// `--dart-define=API_BASE_URL=http://10.0.2.2:3001` (Android emulator) либо
// `http://localhost:3001` (Genymotion/iOS sim).
//
// Caddy на periscop.pro (основной домен): `handle_path /api/* → backend:3001`
// стрипает префикс — поэтому baseUrl с `/api`. Legacy-домен gmd-online.ru
// остаётся живым зеркалом для уже установленных сборок, новые ходят на
// periscop.pro по умолчанию.
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://periscop.pro/api',
);

/// Web origin (без `/api`) — нужен для embed-страниц, открываемых в WebView
/// (например, «Звук вокруг» использует `/embed/audio/<childId>` веб-плеер).
const webOrigin = String.fromEnvironment(
  'WEB_ORIGIN',
  defaultValue: 'https://periscop.pro',
);
