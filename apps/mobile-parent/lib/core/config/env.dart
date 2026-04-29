// Дефолт — prod, чтобы debug-APK на реальном устройстве сразу ходил в боевой
// API. Для разработки на эмуляторе/Genymotion передавать loopback явно через
// `--dart-define=API_BASE_URL=http://10.0.2.2:3001` (Android emulator) либо
// `http://localhost:3001` (Genymotion/iOS sim).
//
// Caddy на gmd.link28rus.ru: `handle_path /api/* → backend:3001` стрипает
// префикс — поэтому baseUrl с `/api`.
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://gmd.link28rus.ru/api',
);
