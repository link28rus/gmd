// Дефолт — prod, чтобы debug-APK на реальном устройстве сразу ходил в боевой
// API. Для разработки на эмуляторе/Genymotion передавать loopback явно через
// `--dart-define=API_BASE_URL=http://10.0.2.2:3001` (Android emulator) либо
// `http://localhost:3001` (Genymotion/iOS sim).
//
// Caddy на gmd-online.ru: `handle_path /api/* → backend:3001` стрипает
// префикс — поэтому baseUrl с `/api`.
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://gmd-online.ru/api',
);

/// Web origin (без `/api`) — нужен для embed-страниц, открываемых в WebView
/// (например, «Звук вокруг» использует `/embed/audio/<childId>` веб-плеер).
const webOrigin = String.fromEnvironment(
  'WEB_ORIGIN',
  defaultValue: 'https://gmd-online.ru',
);
