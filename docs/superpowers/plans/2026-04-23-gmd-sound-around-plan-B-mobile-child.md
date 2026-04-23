# «Звук вокруг ребёнка» — Plan B: mobile-child WebRTC capture + FGS microphone + OEM wizard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Реализовать на mobile-child Android захват микрофона по команде родителя через WebRTC, с foreground-service `microphone` (Android 14+ требование), permission-wizard для `RECORD_AUDIO`, и расширить OEM-wizard инструкциями для Xiaomi/HyperOS/Honor.

**Architecture:** При получении START_AUDIO команды (через существующий short-poll `/child/commands/pending`) Flutter поднимает native `SoundAroundService` (FGS `microphone`). Сервис запускает headless FlutterEngine (паттерн `LocationForegroundService` v0.18.0). В background-isolate'е Dart-код через `flutter_webrtc` создаёт `RTCPeerConnection`, захватывает микрофон, посылает SDP-offer через `POST /child/audio/sessions/:id/ready`, обменивается ICE через `/ice`. По STOP_AUDIO команде или durationSec timeout — сервис останавливается.

**Tech Stack:** Flutter 3.24+ (Dart 3.11+), Riverpod, `flutter_webrtc` ^0.11.x, native Kotlin для FGS, существующие method-channels pattern. Backend API уже готов (Plan A v0.32.0+).

**Spec:** [docs/superpowers/specs/2026-04-23-gmd-sound-around-design.md](../specs/2026-04-23-gmd-sound-around-design.md)
**API docs:** [docs/audio-api.md](../../audio-api.md)

**MVP-trade-offs (зафиксировано):**

- Без FCM. START_AUDIO доставляется через существующий poll `/child/commands/pending` (≈ 2/мин). Latency 0-30 сек. Соответствует Plan A решению.
- iOS не поддерживается (mobile-child Android-only на MVP, см. CLAUDE.md).
- Hidden-mode по умолчанию: ребёнку никаких push/баннеров. Android system privacy indicator (зелёная точка) появляется автоматически — это нельзя обойти, и оно ОК.
- Опциональный тумблер «Уведомлять меня о прослушке» в child-app — отдельная задача после MVP.

---

## File Structure

**Создаём:**

- `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/SoundAroundService.kt` — native FGS
- `apps/mobile-child/lib/features/sound_around/sound_around_entry.dart` — entry-point для headless FlutterEngine (как `lib/background/location_entry.dart`)
- `apps/mobile-child/lib/features/sound_around/sound_around_controller.dart` — RTCPeerConnection lifecycle
- `apps/mobile-child/lib/features/sound_around/audio_command_handler.dart` — обработка START_AUDIO/STOP_AUDIO команд
- `apps/mobile-child/lib/core/native/sound_around_channel.dart` — method channel start/stop FGS
- `apps/mobile-child/lib/core/api/audio_api.dart` — REST client для /child/audio/sessions/\*
- `apps/mobile-child/lib/features/permissions/microphone_step.dart` — permission wizard step
- `apps/mobile-child/test/unit/audio_api_test.dart`
- `apps/mobile-child/test/unit/sound_around_controller_test.dart`
- `apps/mobile-child/test/widget/microphone_step_test.dart`

**Модифицируем:**

- `apps/mobile-child/pubspec.yaml` — добавить `flutter_webrtc: ^0.11.0`, bump version
- `apps/mobile-child/android/app/src/main/AndroidManifest.xml` — `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE`, declare `SoundAroundService`
- `apps/mobile-child/android/app/build.gradle.kts` — minSdk проверка (WebRTC требует ≥21, у нас уже выше)
- `apps/mobile-child/lib/core/api/child_api.dart` — добавить `DeviceCommand.payload` парсинг для START_AUDIO (уже есть Map<String, dynamic>)
- `apps/mobile-child/lib/ingestor/location_ingestor.dart` — обработать START_AUDIO/STOP_AUDIO в существующем `processCommands` callback (либо вынести в отдельный handler — см. Task 9)
- `apps/mobile-child/lib/features/permissions/permissions_wizard.dart` (или wizard-routes) — добавить microphone_step в flow
- `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/MainActivity.kt` — зарегистрировать sound_around_channel
- `CHANGELOG.md` — v0.33.0 entry
- `package.json` (root) — version bump

**Out of scope (для Plans C/D/E):**

- iOS mobile-child (не делаем вообще)
- Web/mobile-parent UI для аудио (Plan C)
- EULA/claim-invite consent UI обновление (Plan D)
- E2E с реальным WebRTC peer-to-peer (Plan E)

---

## Phase 5.3: mobile-child Android implementation

### Task 1: pubspec — flutter_webrtc

**Files:**

- Modify: `apps/mobile-child/pubspec.yaml`

- [ ] **Step 1.1: Добавить dependency**

В блок `dependencies:` после `connectivity_plus` добавить:

```yaml
flutter_webrtc: ^0.11.7 # WebRTC для «Звук вокруг ребёнка»
```

- [ ] **Step 1.2: pub get + verify install**

```bash
cd apps/mobile-child
/d/flutter/bin/flutter pub get
/d/flutter/bin/flutter pub deps | grep flutter_webrtc
```

Expected: `flutter_webrtc 0.11.x` в дереве зависимостей.

- [ ] **Step 1.3: Commit**

```bash
git add apps/mobile-child/pubspec.yaml apps/mobile-child/pubspec.lock
git commit -m "feat(mobile-child): добавить flutter_webrtc для «Звук вокруг»"
```

---

### Task 2: AndroidManifest — permissions + service declaration

**Files:**

- Modify: `apps/mobile-child/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 2.1: Добавить permissions**

В блок `<uses-permission ...>` после `MODIFY_AUDIO_SETTINGS` добавить:

```xml
    <!-- «Звук вокруг ребёнка» (Phase 5.3) — захват микрофона по запросу родителя.
         FOREGROUND_SERVICE_MICROPHONE обязателен с Android 14 (API 34). -->
    <uses-permission android:name="android.permission.RECORD_AUDIO"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE"/>
```

- [ ] **Step 2.2: Декларация SoundAroundService**

В блок `<application>` после `SignalSoundService` добавить:

```xml
        <!-- SoundAroundService — FGS для аудиомониторинга «Звук вокруг ребёнка».
             Стартует по START_AUDIO команде из poll'а /child/commands/pending.
             Держит headless FlutterEngine, который через flutter_webrtc создаёт
             RTCPeerConnection и шлёт mic-stream на parent через TURN-сервер.
             Останавливается по STOP_AUDIO команде или durationSec timeout. -->
        <service
            android:name=".SoundAroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="microphone"/>
```

- [ ] **Step 2.3: Build verify**

```bash
cd apps/mobile-child
/d/flutter/bin/flutter build apk --debug --target-platform android-arm64
```

Expected: build PASS, нет manifest-errors.

- [ ] **Step 2.4: Commit**

```bash
git add apps/mobile-child/android/app/src/main/AndroidManifest.xml
git commit -m "feat(mobile-child): manifest — RECORD_AUDIO + SoundAroundService FGS"
```

---

### Task 3: AudioApi (Dart REST client)

**Files:**

- Create: `apps/mobile-child/lib/core/api/audio_api.dart`
- Create: `apps/mobile-child/test/unit/audio_api_test.dart`

- [ ] **Step 3.1: Failing test первым**

Create `apps/mobile-child/test/unit/audio_api_test.dart`:

```dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/core/api/audio_api.dart';

void main() {
  group('AudioApi.sendReady', () {
    test('POST /child/audio/sessions/:id/ready with sdp body', () async {
      Map<String, dynamic>? capturedBody;
      String? capturedPath;
      String? capturedHeader;

      final dio = Dio()
        ..httpClientAdapter = _MockAdapter(
          (RequestOptions opts) {
            capturedPath = opts.path;
            capturedBody = opts.data as Map<String, dynamic>;
            capturedHeader = opts.headers['X-Child-Token'] as String?;
            return ResponseBody.fromString('', 204);
          },
        );

      final api = AudioApi(dio);
      await api.sendReady(
        sessionId: 'sess_abc',
        deviceToken: 'tok_123',
        sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n',
      );

      expect(capturedPath, '/child/audio/sessions/sess_abc/ready');
      expect(capturedBody, {'sdp': 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n'});
      expect(capturedHeader, 'tok_123');
    });
  });

  group('AudioApi.sendIce', () {
    test('POST /child/audio/sessions/:id/ice with candidate body', () async {
      // ... аналогичный тест
    });
  });

  group('AudioApi.sendError', () {
    test('POST /child/audio/sessions/:id/error with code+message', () async {
      // ... аналогичный тест
    });

    test('omits message when not provided', () async {
      // ... edge case
    });
  });

  group('AudioApi error handling', () {
    test('throws UnauthorizedException on 401', () async {
      final dio = Dio()
        ..httpClientAdapter = _MockAdapter(
          (_) => ResponseBody.fromString('{"code":"unauthorized"}', 401),
        );
      final api = AudioApi(dio);
      expect(
        () => api.sendReady(sessionId: 's', deviceToken: 't', sdp: 'v=0'),
        throwsA(isA<UnauthorizedException>()),
      );
    });
  });
}

// Минимальный mock adapter (см. claim_controller_test.dart как pattern)
class _MockAdapter implements HttpClientAdapter {
  _MockAdapter(this.onRequest);
  final ResponseBody Function(RequestOptions) onRequest;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future? cancelFuture,
  ) async => onRequest(options);

  @override
  void close({bool force = false}) {}
}
```

(Проверь существующий `claim_controller_test.dart` или `child_api_test.dart` — следуй их паттерну mock-adapter'а. Не вводи новый стиль.)

Run:

```bash
cd apps/mobile-child
/d/flutter/bin/flutter test test/unit/audio_api_test.dart
```

Expected: FAIL — `audio_api.dart` not found.

- [ ] **Step 3.2: Реализация AudioApi**

Create `apps/mobile-child/lib/core/api/audio_api.dart`:

```dart
import 'package:dio/dio.dart';
import 'api_exceptions.dart';

/// REST-клиент для /child/audio/sessions/* endpoints
/// (см. docs/audio-api.md, Phase 5.3).
class AudioApi {
  AudioApi(this._dio);
  final Dio _dio;

  /// Отправить SDP-offer от child → переход PENDING → READY на backend.
  Future<void> sendReady({
    required String sessionId,
    required String deviceToken,
    required String sdp,
  }) async {
    await _post('/child/audio/sessions/$sessionId/ready', deviceToken, {'sdp': sdp});
  }

  /// Отправить ICE-candidate от child.
  Future<void> sendIce({
    required String sessionId,
    required String deviceToken,
    required String candidate,
  }) async {
    await _post(
      '/child/audio/sessions/$sessionId/ice',
      deviceToken,
      {'candidate': candidate},
    );
  }

  /// Сообщить backend об ошибке (PERMISSION_DENIED / MIC_BUSY / OEM_BLOCKED / NETWORK_ERROR / UNKNOWN).
  /// Backend помечает session FAILED и шлёт STOP_AUDIO на child (но child уже знает).
  Future<void> sendError({
    required String sessionId,
    required String deviceToken,
    required String code,
    String? message,
  }) async {
    await _post('/child/audio/sessions/$sessionId/error', deviceToken, {
      'code': code,
      if (message != null) 'message': message,
    });
  }

  Future<void> _post(String path, String token, Map<String, dynamic> body) async {
    try {
      await _dio.post(
        path,
        data: body,
        options: Options(headers: {'X-Child-Token': token}),
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) throw const UnauthorizedException();
      if (status == null) throw NetworkException(e.message ?? 'Сеть недоступна');
      throw ServerException('Ошибка сервера', status);
    }
  }
}
```

Run: `flutter test test/unit/audio_api_test.dart` → expect все 5 тестов PASS.

- [ ] **Step 3.3: Commit**

```bash
git add apps/mobile-child/lib/core/api/audio_api.dart apps/mobile-child/test/unit/audio_api_test.dart
git commit -m "feat(mobile-child): AudioApi REST client (ready/ice/error)"
```

---

### Task 4: SoundAroundChannel (Flutter ↔ Native bridge)

**Files:**

- Create: `apps/mobile-child/lib/core/native/sound_around_channel.dart`

- [ ] **Step 4.1: Method channel definition**

Create `apps/mobile-child/lib/core/native/sound_around_channel.dart`:

```dart
import 'package:flutter/services.dart';

/// Method channel для управления native-side `SoundAroundService` (Android FGS
/// типа microphone). Поднимается по START_AUDIO команде, опускается по STOP.
///
/// Native-сторона при start запускает headless FlutterEngine с entry-point
/// `soundAroundEntryPoint` (см. lib/features/sound_around/sound_around_entry.dart),
/// которому через background channel пробрасывает sessionId/turnCreds/durationSec.
class SoundAroundChannel {
  SoundAroundChannel({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel('gmd.child/sound_around');

  final MethodChannel _channel;

  /// Запустить FGS с переданным контекстом сессии.
  /// Native: startForegroundService(SoundAroundService) + startForeground +
  /// поднимает FlutterEngine с background isolate.
  Future<void> start({
    required String sessionId,
    required Map<String, dynamic> turnCreds, // {url, username, password, ttl}
    required int durationSec,
  }) async {
    await _channel.invokeMethod('start', {
      'sessionId': sessionId,
      'turnCreds': turnCreds,
      'durationSec': durationSec,
    });
  }

  /// Остановить FGS (например, по STOP_AUDIO команде или duration timeout).
  /// Native: stopForeground(STOP_FOREGROUND_REMOVE) + stopSelf + кила engine.
  Future<void> stop() async {
    await _channel.invokeMethod('stop');
  }
}
```

- [ ] **Step 4.2: Commit**

```bash
git add apps/mobile-child/lib/core/native/sound_around_channel.dart
git commit -m "feat(mobile-child): SoundAroundChannel method-channel (Flutter↔Native bridge)"
```

---

### Task 5: SoundAroundService.kt (native FGS skeleton)

**Files:**

- Create: `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/SoundAroundService.kt`
- Modify: `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/MainActivity.kt` — зарегистрировать channel

- [ ] **Step 5.1: Прочитай LocationForegroundService.kt — паттерн для headless FlutterEngine**

```bash
cat apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/LocationForegroundService.kt
```

Особое внимание:

- Как создаётся `FlutterEngine` с `DartExecutor.DartEntrypoint`
- Как передаются параметры в Dart entry point
- Как обрабатывается `onTaskRemoved` / `onDestroy`
- Как создаётся persistent notification

Skeleton нашей `SoundAroundService.kt` повторит этот паттерн с adjustment:

- `foregroundServiceType` = `FOREGROUND_SERVICE_TYPE_MICROPHONE` вместо `LOCATION`
- entry-point Dart-функции — `soundAroundEntryPoint` (мы определим в Task 7)
- В отличие от LocationForegroundService — наш сервис **временный** (5 мин average), не вечный

- [ ] **Step 5.2: SoundAroundService.kt**

Create `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/SoundAroundService.kt`:

```kotlin
package ru.link28rus.gmd.child

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.embedding.engine.loader.FlutterLoader
import io.flutter.plugin.common.MethodChannel
import io.flutter.view.FlutterCallbackInformation

/**
 * Foreground service для «Звук вокруг ребёнка».
 *
 * Запускается из Flutter (см. SoundAroundChannel.start) при получении
 * START_AUDIO команды. Поднимает headless FlutterEngine, который через
 * flutter_webrtc создаёт RTCPeerConnection и захватывает микрофон.
 *
 * foregroundServiceType=microphone — обязательное требование Android 14+
 * для FGS, использующих RECORD_AUDIO. Без этого FGS будет убит системой.
 *
 * При получении STOP (либо явный stop вызов, либо timeout durationSec в Dart)
 * сервис выгружает FlutterEngine и stopSelf().
 */
class SoundAroundService : Service() {

    companion object {
        private const val TAG = "SoundAroundService"
        private const val NOTIFICATION_ID = 4711
        private const val NOTIFICATION_CHANNEL_ID = "gmd_sound_around"
        const val EXTRA_SESSION_ID = "sessionId"
        const val EXTRA_TURN_CREDS = "turnCreds" // JSON-string
        const val EXTRA_DURATION_SEC = "durationSec"
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
    }

    private var flutterEngine: FlutterEngine? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        DiagLog.append(this, "SoundAroundService onCreate")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopForegroundCompat()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                // Generic-start (без specific action или ACTION_START):
                // запускаем FGS с минимальным notification + поднимаем engine.
                startForegroundCompat()
                val sessionId = intent?.getStringExtra(EXTRA_SESSION_ID).orEmpty()
                val turnCredsJson = intent?.getStringExtra(EXTRA_TURN_CREDS).orEmpty()
                val durationSec = intent?.getIntExtra(EXTRA_DURATION_SEC, 300) ?: 300
                startFlutterEngine(sessionId, turnCredsJson, durationSec)
            }
        }
        return START_NOT_STICKY // не хотим автоматический restart системы
    }

    override fun onDestroy() {
        DiagLog.append(this, "SoundAroundService onDestroy")
        flutterEngine?.destroy()
        flutterEngine = null
        super.onDestroy()
    }

    // Headless FlutterEngine с background-entry-point. Обнаружить
    // entry-point по callbackHandle, который Dart-сторона должна предварительно
    // зарегистрировать (но мы можем использовать упрощённый вариант — entry
    // point по name 'soundAroundEntryPoint').
    private fun startFlutterEngine(sessionId: String, turnCredsJson: String, durationSec: Int) {
        val loader = FlutterLoader()
        loader.startInitialization(applicationContext)
        loader.ensureInitializationComplete(applicationContext, null)

        val engine = FlutterEngine(applicationContext)
        val entrypoint = DartExecutor.DartEntrypoint(
            loader.findAppBundlePath(),
            "soundAroundEntryPoint",
        )
        engine.dartExecutor.executeDartEntrypoint(entrypoint)

        // Background channel для передачи параметров сессии в Dart.
        val bgChannel = MethodChannel(
            engine.dartExecutor.binaryMessenger,
            "gmd.child/sound_around_bg",
        )
        bgChannel.setMethodCallHandler { call, result ->
            when (call.method) {
                "stopSelf" -> {
                    // Dart запросил завершение (durationSec истёк / parent stop / ошибка).
                    DiagLog.append(this, "SoundAround Dart requested stop: ${call.arguments}")
                    stopForegroundCompat()
                    stopSelf()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }

        // Передаём параметры сессии через invokeMethod.
        bgChannel.invokeMethod("init", mapOf(
            "sessionId" to sessionId,
            "turnCredsJson" to turnCredsJson,
            "durationSec" to durationSec,
        ))

        flutterEngine = engine
    }

    private fun startForegroundCompat() {
        val notif = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notif)
        }
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Аудиомониторинг",
                NotificationManager.IMPORTANCE_MIN, // самый низкий — без heads-up
            ).apply {
                description = "Активная сессия аудиомониторинга"
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    /**
     * Минималистичная notification — required by Android для FGS, но мы
     * делаем её максимально невыразительной (hidden-mode по умолчанию).
     * Текст generic. System privacy indicator (зелёная точка) появится
     * автоматически при захвате микрофона — это by design Android, обойти нельзя.
     */
    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("gmd_child")
            .setContentText("Сервис активен")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .build()
    }
}
```

- [ ] **Step 5.3: MainActivity — зарегистрировать channel `gmd.child/sound_around`**

Modify `apps/mobile-child/android/app/src/main/kotlin/ru/link28rus/gmd/child/MainActivity.kt`:

Прочитай файл, найди где регистрируются другие channels (signal, device_admin, location_service). Добавь по тому же паттерну:

```kotlin
private val SOUND_AROUND_CHANNEL = "gmd.child/sound_around"

override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    // ... existing channels

    MethodChannel(flutterEngine.dartExecutor.binaryMessenger, SOUND_AROUND_CHANNEL)
        .setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    val sessionId = call.argument<String>("sessionId") ?: ""
                    @Suppress("UNCHECKED_CAST")
                    val turnCreds = call.argument<Map<String, Any?>>("turnCreds") ?: emptyMap()
                    val durationSec = call.argument<Int>("durationSec") ?: 300

                    val intent = Intent(this, SoundAroundService::class.java).apply {
                        putExtra(SoundAroundService.EXTRA_SESSION_ID, sessionId)
                        putExtra(SoundAroundService.EXTRA_TURN_CREDS,
                            org.json.JSONObject(turnCreds).toString())
                        putExtra(SoundAroundService.EXTRA_DURATION_SEC, durationSec)
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(intent)
                    } else {
                        startService(intent)
                    }
                    result.success(null)
                }
                "stop" -> {
                    val intent = Intent(this, SoundAroundService::class.java).apply {
                        action = SoundAroundService.ACTION_STOP
                    }
                    startService(intent)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
}
```

- [ ] **Step 5.4: Build verify**

```bash
cd apps/mobile-child
/d/flutter/bin/flutter build apk --debug --target-platform android-arm64
```

Expected: build success.

- [ ] **Step 5.5: Commit**

```bash
git add apps/mobile-child/android/
git commit -m "feat(mobile-child): SoundAroundService.kt FGS microphone + MainActivity channel"
```

---

### Task 6: pluginRegistrant для headless FlutterEngine

**Files:**

- Modify: `apps/mobile-child/lib/main.dart` (или `lib/background/location_entry.dart` если pattern там)

**Контекст:** headless FlutterEngine не получает плагины автоматически — нужно явно вызвать `DartPluginRegistrant.ensureInitialized()` или эквивалент. Для flutter_webrtc это критично (иначе native side плагина не подключается).

- [ ] **Step 6.1: Прочитать существующий location_entry.dart**

```bash
cat apps/mobile-child/lib/background/location_entry.dart | head -40
```

Если там уже есть pluginRegistrant call — копировать паттерн в Task 7. Если нет — добавим.

- [ ] **Step 6.2: Если нужно — обновить existing background entry**

Если паттерн отсутствует — добавь `DartPluginRegistrant.ensureInitialized()` в начало entry-point функций.

- [ ] **Step 6.3: Commit (только если изменения)**

```bash
git add apps/mobile-child/lib/background/
git commit -m "fix(mobile-child): DartPluginRegistrant.ensureInitialized для headless engines"
```

(Если ничего не изменилось — skip commit, переходи к Task 7.)

---

### Task 7: sound_around_entry.dart (background isolate entry-point)

**Files:**

- Create: `apps/mobile-child/lib/features/sound_around/sound_around_entry.dart`

- [ ] **Step 7.1: Entry-point**

Create `apps/mobile-child/lib/features/sound_around/sound_around_entry.dart`:

```dart
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'sound_around_controller.dart';

/// Top-level entry-point для headless FlutterEngine, поднятого
/// из SoundAroundService.kt. Регистрируется в native через
/// `DartExecutor.DartEntrypoint(..., "soundAroundEntryPoint")`.
///
/// Vergisse PRAGMA: vm:entry-point — без него tree-shaker удалит функцию
/// из release-сборки.
@pragma('vm:entry-point')
void soundAroundEntryPoint() {
  // Bind binding для plugin-registry в background isolate.
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();

  const bgChannel = MethodChannel('gmd.child/sound_around_bg');
  late final SoundAroundController controller;
  controller = SoundAroundController(
    onStopRequest: ({String? reason}) {
      // Сообщить native, что нужно завершить FGS.
      bgChannel.invokeMethod('stopSelf', {'reason': reason ?? 'unknown'});
    },
  );

  bgChannel.setMethodCallHandler((call) async {
    switch (call.method) {
      case 'init':
        final args = (call.arguments as Map).cast<String, dynamic>();
        final sessionId = args['sessionId'] as String;
        final turnCredsJson = args['turnCredsJson'] as String;
        final durationSec = args['durationSec'] as int;
        final turnCreds = (jsonDecode(turnCredsJson) as Map).cast<String, dynamic>();
        await controller.start(
          sessionId: sessionId,
          turnCreds: turnCreds,
          durationSec: durationSec,
        );
        return null;
      case 'forceStop':
        await controller.stop(reason: 'native_force_stop');
        return null;
      default:
        throw MissingPluginException('Unknown method: ${call.method}');
    }
  });
}
```

- [ ] **Step 7.2: Commit**

```bash
git add apps/mobile-child/lib/features/sound_around/sound_around_entry.dart
git commit -m "feat(mobile-child): sound_around_entry — background entry-point для FGS"
```

---

### Task 8: SoundAroundController (RTCPeerConnection lifecycle)

**Files:**

- Create: `apps/mobile-child/lib/features/sound_around/sound_around_controller.dart`
- Create: `apps/mobile-child/test/unit/sound_around_controller_test.dart`

- [ ] **Step 8.1: Failing test — error path (Permission denied)**

Create `apps/mobile-child/test/unit/sound_around_controller_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/features/sound_around/sound_around_controller.dart';

void main() {
  group('SoundAroundController error handling', () {
    test('reports PERMISSION_DENIED when getUserMedia throws PermissionDenied', () async {
      // Использовать mock-инжекцию для navigator.mediaDevices
      // (зависит от того, как структурирован контроллер — см. Step 8.2 для дизайна).
      // Этот тест-файл — placeholder; полный mock'инг flutter_webrtc сложен.
      // Для MVP допустимо ограничиться смок-проверкой через интеграционный тест
      // на устройстве (Task 13).
    }, skip: 'Requires native flutter_webrtc mock — covered by integration test in Task 13');
  });
}
```

(Note: flutter_webrtc — нативный плагин, hard to mock в unit test. Acceptable practice — пометить skip + ссылаться на integration/manual test. См. existing patterns в проекте: `permission_handler` тоже мокается через `WidgetTester.binding`).

- [ ] **Step 8.2: Реализация**

Create `apps/mobile-child/lib/features/sound_around/sound_around_controller.dart`:

```dart
import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../core/api/api_exceptions.dart';
import '../../core/api/audio_api.dart';
import '../../core/config/env.dart';
import '../../core/diag/diag_channel.dart';
import '../../core/storage/secure_storage_service.dart';

typedef StopRequestCallback = void Function({String? reason});

/// Управляет lifecycle одной audio-сессии: setup PeerConnection,
/// захват микрофона, обмен SDP/ICE с backend, auto-stop по durationSec
/// или явному stop request от parent (через STOP_AUDIO команду — приходит
/// через background channel из native).
///
/// Ошибки:
///  - getUserMedia denied / busy → POST /error code=PERMISSION_DENIED|MIC_BUSY
///  - сетевые → POST /error code=NETWORK_ERROR
///  - неожиданные → POST /error code=UNKNOWN
///
/// После любого терминального события вызывает onStopRequest — native FGS
/// получает stopSelf() и убивает engine.
class SoundAroundController {
  SoundAroundController({
    required this.onStopRequest,
    AudioApi? audioApi,
    SecureStorageService? storage,
  })  : _audioApi = audioApi ?? AudioApi(_buildDio()),
        _storage = storage ?? SecureStorageService();

  final StopRequestCallback onStopRequest;
  final AudioApi _audioApi;
  final SecureStorageService _storage;

  RTCPeerConnection? _pc;
  MediaStream? _localStream;
  Timer? _autoStopTimer;
  String? _sessionId;
  String? _deviceToken;
  bool _stopped = false;

  static Dio _buildDio() => Dio(BaseOptions(
        baseUrl: Env.apiBaseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 30),
      ));

  Future<void> start({
    required String sessionId,
    required Map<String, dynamic> turnCreds,
    required int durationSec,
  }) async {
    _sessionId = sessionId;
    _deviceToken = await _storage.getDeviceToken();
    if (_deviceToken == null || _deviceToken!.isEmpty) {
      DiagChannel.warn('SoundAround: no device token — cannot signal');
      onStopRequest(reason: 'no_token');
      return;
    }

    DiagChannel.info('SoundAround start sessionId=$sessionId duration=${durationSec}s');

    try {
      // 1) Configure PeerConnection с TURN-credentials.
      final config = {
        'iceServers': [
          {
            'urls': turnCreds['url'],
            'username': turnCreds['username'],
            'credential': turnCreds['password'],
          },
        ],
        'iceTransportPolicy': 'relay', // force-relay (skip direct P2P)
      };
      _pc = await createPeerConnection(config);

      // 2) ICE-candidate listener — отправляем на backend.
      _pc!.onIceCandidate = (cand) {
        if (cand.candidate == null || _stopped) return;
        _audioApi.sendIce(
          sessionId: sessionId,
          deviceToken: _deviceToken!,
          candidate: cand.candidate!,
        ).catchError((e) {
          DiagChannel.warn('SoundAround sendIce failed: $e');
        });
      };

      // 3) Захват микрофона.
      final stream = await navigator.mediaDevices.getUserMedia({
        'audio': {
          'echoCancellation': true,
          'noiseSuppression': true,
          'autoGainControl': true,
        },
        'video': false,
      });
      _localStream = stream;
      for (final track in stream.getAudioTracks()) {
        await _pc!.addTrack(track, stream);
      }

      // 4) Создать SDP-offer и отправить.
      final offer = await _pc!.createOffer({'offerToReceiveAudio': false});
      await _pc!.setLocalDescription(offer);
      await _audioApi.sendReady(
        sessionId: sessionId,
        deviceToken: _deviceToken!,
        sdp: offer.sdp!,
      );

      // 5) Auto-stop через durationSec + buffer.
      _autoStopTimer = Timer(Duration(seconds: durationSec + 5), () {
        DiagChannel.info('SoundAround auto-stop по durationSec timeout');
        stop(reason: 'duration_timeout');
      });

      DiagChannel.info('SoundAround READY отправлен, ждём parent answer + ICE');
    } on Exception catch (e) {
      DiagChannel.error('SoundAround start failed: $e');
      String code = 'UNKNOWN';
      if (e.toString().contains('NotAllowedError') ||
          e.toString().toLowerCase().contains('permission')) {
        code = 'PERMISSION_DENIED';
      } else if (e.toString().toLowerCase().contains('busy') ||
          e.toString().toLowerCase().contains('in use')) {
        code = 'MIC_BUSY';
      } else if (e is NetworkException) {
        code = 'NETWORK_ERROR';
      }
      try {
        await _audioApi.sendError(
          sessionId: sessionId,
          deviceToken: _deviceToken ?? '',
          code: code,
          message: e.toString(),
        );
      } catch (_) {}
      await stop(reason: 'start_failed');
    }
  }

  /// Применить SDP-answer от parent (приходит через poll-команду или future
  /// /child/audio/sessions/:id/answer-poll endpoint, MVP — через подобный механизм).
  ///
  /// На MVP backend парент-answer не пушит на child; child запоминает offer и
  /// ждёт когда WebRTC сам обнаружит peer через TURN allocate. Это упрощение —
  /// для real-time нужен либо answer-poll endpoint, либо FCM push answer.
  ///
  /// Для MVP: child создаёт offer, отдаёт READY, дальше ждёт ICE-обмен через
  /// TURN signaling без явного answer apply. Это TBD — нужно уточнить с backend.
  /// Заглушка для будущей интеграции:
  Future<void> applyAnswer(String sdp) async {
    if (_pc == null || _stopped) return;
    final desc = RTCSessionDescription(sdp, 'answer');
    await _pc!.setRemoteDescription(desc);
    DiagChannel.info('SoundAround answer applied');
  }

  Future<void> stop({String? reason}) async {
    if (_stopped) return;
    _stopped = true;
    _autoStopTimer?.cancel();
    DiagChannel.info('SoundAround stop reason=$reason');
    try {
      _localStream?.getTracks().forEach((t) => t.stop());
      await _localStream?.dispose();
      await _pc?.close();
    } catch (e) {
      DiagChannel.warn('SoundAround stop cleanup error: $e');
    }
    onStopRequest(reason: reason);
  }
}
```

> ⚠ **TBD: SDP-answer delivery to child.** Backend Plan A не пушит answer на child через polling-команду. Это **gap** между Plan A и Plan B. Опции:
>
> - (a) Добавить answer в payload новой команды `AUDIO_ANSWER` (минимальное изменение Plan A backend)
> - (b) Polling endpoint `GET /child/audio/sessions/:id/answer` — child poll'ит каждую секунду пока не получит
> - (c) Long-poll endpoint
>
> Для MVP — **(a)** как простейшее. Это требует ОТДЕЛЬНОЙ задачи в Plan A (выходит за scope этого плейна) ИЛИ в начале Plan C (parent-controller получает answer и backend засылает команду). Зафиксировать в Open Questions ниже.

- [ ] **Step 8.3: Run unit tests**

```bash
cd apps/mobile-child
/d/flutter/bin/flutter test test/unit/sound_around_controller_test.dart
```

Expected: skip (один тест помечен skip). OK.

- [ ] **Step 8.4: Commit**

```bash
git add apps/mobile-child/lib/features/sound_around/ apps/mobile-child/test/unit/sound_around_controller_test.dart
git commit -m "feat(mobile-child): SoundAroundController — RTCPeerConnection lifecycle + signaling"
```

---

### Task 9: AudioCommandHandler — обработка START_AUDIO/STOP_AUDIO

**Files:**

- Create: `apps/mobile-child/lib/features/sound_around/audio_command_handler.dart`
- Modify: `apps/mobile-child/lib/ingestor/location_ingestor.dart` (или другое место где обрабатывается DeviceCommand poll)

- [ ] **Step 9.1: Прочитать как обрабатывается PLAY_SIGNAL команда**

```bash
grep -rn "PLAY_SIGNAL\|DeviceCommand\|getPendingCommands" apps/mobile-child/lib/
```

Найти, где после `getPendingCommands` команды dispatch'атся. Скорее всего — в `location_ingestor.dart` после `flushQueue`.

- [ ] **Step 9.2: AudioCommandHandler**

Create `apps/mobile-child/lib/features/sound_around/audio_command_handler.dart`:

```dart
import '../../core/api/child_api.dart';
import '../../core/diag/diag_channel.dart';
import '../../core/native/sound_around_channel.dart';

/// Обрабатывает START_AUDIO и STOP_AUDIO команды из poll'а DeviceCommand'ов.
/// Использует SoundAroundChannel для управления native FGS.
class AudioCommandHandler {
  AudioCommandHandler({SoundAroundChannel? channel})
      : _channel = channel ?? SoundAroundChannel();

  final SoundAroundChannel _channel;

  /// Возвращает true если команда обработана (надо отправить ack).
  Future<bool> handle(DeviceCommand cmd) async {
    switch (cmd.type) {
      case 'START_AUDIO':
        return _handleStart(cmd);
      case 'STOP_AUDIO':
        return _handleStop(cmd);
      default:
        return false; // не наша команда
    }
  }

  Future<bool> _handleStart(DeviceCommand cmd) async {
    final payload = cmd.payload;
    if (payload == null) {
      DiagChannel.warn('START_AUDIO without payload — ignored');
      return true; // ack чтобы не повторялась
    }
    final sessionId = payload['sessionId'] as String?;
    final turnCreds = payload['turnCreds'] as Map<String, dynamic>?;
    final durationSec = payload['durationSec'] as int?;
    if (sessionId == null || turnCreds == null || durationSec == null) {
      DiagChannel.warn('START_AUDIO malformed payload — ignored');
      return true;
    }
    DiagChannel.info('START_AUDIO sessionId=$sessionId duration=${durationSec}s');
    try {
      await _channel.start(
        sessionId: sessionId,
        turnCreds: turnCreds,
        durationSec: durationSec,
      );
      return true;
    } catch (e) {
      DiagChannel.error('START_AUDIO channel.start failed: $e');
      return false; // не ack — ретрай при следующем poll
    }
  }

  Future<bool> _handleStop(DeviceCommand cmd) async {
    DiagChannel.info('STOP_AUDIO sessionId=${cmd.payload?['sessionId']}');
    try {
      await _channel.stop();
      return true;
    } catch (e) {
      DiagChannel.error('STOP_AUDIO channel.stop failed: $e');
      return true; // ack даже если ошибка — STOP идемпотентен
    }
  }
}
```

- [ ] **Step 9.3: Интеграция в command-poller**

Modify файл из Step 9.1 (вероятно `location_ingestor.dart`) — добавить AudioCommandHandler в обработчик команд.

Псевдо-патч (точное место зависит от структуры):

```dart
// в начале файла:
import '../features/sound_around/audio_command_handler.dart';

// в классе LocationIngestor (или wherever):
final _audioHandler = AudioCommandHandler();

// в обработчике pending-команд:
for (final cmd in commands) {
  bool handled = false;
  if (cmd.type == 'PLAY_SIGNAL') {
    // existing handler
    handled = true;
  } else {
    handled = await _audioHandler.handle(cmd);
  }
  if (handled) {
    await api.ackCommand(deviceToken: token, commandId: cmd.id);
  }
}
```

(Точная схема зависит от текущего кода. Если там switch — добавить cases.)

- [ ] **Step 9.4: Тесты для AudioCommandHandler**

Add to `apps/mobile-child/test/unit/audio_command_handler_test.dart` (создай файл):

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:gmd_child/core/api/child_api.dart';
import 'package:gmd_child/core/native/sound_around_channel.dart';
import 'package:gmd_child/features/sound_around/audio_command_handler.dart';

class _MockChannel extends Mock implements SoundAroundChannel {}

void main() {
  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  group('AudioCommandHandler', () {
    late _MockChannel channel;
    late AudioCommandHandler handler;

    setUp(() {
      channel = _MockChannel();
      handler = AudioCommandHandler(channel: channel);
    });

    test('START_AUDIO with full payload calls channel.start, returns true', () async {
      when(() => channel.start(
            sessionId: any(named: 'sessionId'),
            turnCreds: any(named: 'turnCreds'),
            durationSec: any(named: 'durationSec'),
          )).thenAnswer((_) async {});

      final cmd = DeviceCommand(
        id: 'c1',
        type: 'START_AUDIO',
        payload: {
          'sessionId': 's1',
          'turnCreds': {'url': 'turn:x', 'username': 'u', 'password': 'p', 'ttl': 600},
          'durationSec': 60,
        },
      );
      final ok = await handler.handle(cmd);
      expect(ok, true);
      verify(() => channel.start(
            sessionId: 's1',
            turnCreds: any(named: 'turnCreds'),
            durationSec: 60,
          )).called(1);
    });

    test('START_AUDIO without payload returns true (ack to drop), no channel call', () async {
      final cmd = DeviceCommand(id: 'c1', type: 'START_AUDIO', payload: null);
      final ok = await handler.handle(cmd);
      expect(ok, true);
      verifyNever(() => channel.start(
            sessionId: any(named: 'sessionId'),
            turnCreds: any(named: 'turnCreds'),
            durationSec: any(named: 'durationSec'),
          ));
    });

    test('STOP_AUDIO calls channel.stop, returns true', () async {
      when(() => channel.stop()).thenAnswer((_) async {});
      final cmd = DeviceCommand(id: 'c1', type: 'STOP_AUDIO', payload: {'sessionId': 's1'});
      final ok = await handler.handle(cmd);
      expect(ok, true);
      verify(() => channel.stop()).called(1);
    });

    test('unknown command type returns false', () async {
      final cmd = DeviceCommand(id: 'c1', type: 'PLAY_SIGNAL', payload: {});
      final ok = await handler.handle(cmd);
      expect(ok, false);
    });
  });
}
```

Run:

```bash
cd apps/mobile-child
/d/flutter/bin/flutter test test/unit/audio_command_handler_test.dart
```

Expected: 4/4 PASS.

- [ ] **Step 9.5: Commit**

```bash
git add apps/mobile-child/lib/features/sound_around/audio_command_handler.dart \
        apps/mobile-child/lib/ingestor/location_ingestor.dart \
        apps/mobile-child/test/unit/audio_command_handler_test.dart
git commit -m "feat(mobile-child): AudioCommandHandler + интеграция в poll-loop"
```

---

### Task 10: Permission wizard — microphone step

**Files:**

- Create: `apps/mobile-child/lib/features/permissions/microphone_step.dart`
- Create: `apps/mobile-child/test/widget/microphone_step_test.dart`
- Modify: routing/wizard sequence file (см. как зарегистрированы другие steps)

- [ ] **Step 10.1: Прочитать существующий step как pattern**

```bash
cat apps/mobile-child/lib/features/permissions/notifications_step.dart
```

(Notifications_step проще всего — copy-paste с adjustment под mic.)

- [ ] **Step 10.2: MicrophoneStep widget**

Create `apps/mobile-child/lib/features/permissions/microphone_step.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import 'permissions_wizard.dart';

class MicrophoneStep extends StatelessWidget {
  const MicrophoneStep({
    super.key,
    required this.stepIndex,
    required this.totalSteps,
    required this.onNext,
  });

  final int stepIndex;
  final int totalSteps;
  final VoidCallback onNext;

  Future<void> _request(BuildContext context) async {
    final status = await Permission.microphone.request();
    if (!context.mounted) return;
    if (status.isGranted) {
      onNext();
    } else if (status.isPermanentlyDenied) {
      // Подсказать открыть настройки
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Откройте настройки и разрешите доступ к микрофону вручную'),
      ));
      await openAppSettings();
    } else {
      onNext(); // skip — родитель не сможет использовать «Звук вокруг», но другие фичи работают
    }
  }

  @override
  Widget build(BuildContext context) {
    return PermissionsWizardScaffold(
      stepIndex: stepIndex,
      totalSteps: totalSteps,
      title: 'Доступ к микрофону',
      description:
          'Нужен для функции «Звук вокруг ребёнка» — родитель сможет в кризисной '
          'ситуации удалённо услышать, что происходит рядом. Доступ запрашивается '
          'только при явном запросе родителя; запись не хранится на сервере.',
      onRequest: () => _request(context),
      onSkip: onNext,
      actionLabel: 'Разрешить',
    );
  }
}
```

- [ ] **Step 10.3: Widget test**

Create `apps/mobile-child/test/widget/microphone_step_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/features/permissions/microphone_step.dart';

void main() {
  testWidgets('MicrophoneStep renders title, description, and buttons', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: MicrophoneStep(
        stepIndex: 4,
        totalSteps: 5,
        onNext: () {},
      ),
    ));

    expect(find.text('Доступ к микрофону'), findsOneWidget);
    expect(find.textContaining('Звук вокруг ребёнка'), findsOneWidget);
    expect(find.text('Разрешить'), findsOneWidget);
    expect(find.text('Пропустить'), findsOneWidget);
  });

  testWidgets('Skip calls onNext', (tester) async {
    var nextCalls = 0;
    await tester.pumpWidget(MaterialApp(
      home: MicrophoneStep(
        stepIndex: 4,
        totalSteps: 5,
        onNext: () => nextCalls++,
      ),
    ));
    await tester.tap(find.text('Пропустить'));
    await tester.pumpAndSettle();
    expect(nextCalls, 1);
  });
}
```

- [ ] **Step 10.4: Зарегистрировать step в wizard**

Найти, где определена последовательность steps (вероятно в `app_router.dart` или подобном).

Прочитать через grep: `grep -rn "NotificationsStep\|notifications_step" apps/mobile-child/lib/`

Добавить `MicrophoneStep` в последовательность (рекомендуется ПОСЛЕ `NotificationsStep` и ПЕРЕД финальным шагом). Обновить `totalSteps` если он hardcoded.

- [ ] **Step 10.5: Run tests + build**

```bash
cd apps/mobile-child
/d/flutter/bin/flutter test test/widget/microphone_step_test.dart
/d/flutter/bin/flutter build apk --debug --target-platform android-arm64
```

Expected: tests PASS, build success.

- [ ] **Step 10.6: Commit**

```bash
git add apps/mobile-child/lib/features/permissions/microphone_step.dart \
        apps/mobile-child/test/widget/microphone_step_test.dart \
        apps/mobile-child/lib/router/  # или wherever flow зарегистрирован
git commit -m "feat(mobile-child): permissions wizard — microphone step"
```

---

### Task 11: OEM-wizard расширение (Xiaomi/HyperOS, Honor, Samsung)

**Files:**

- Modify: `apps/mobile-child/lib/features/permissions/permissions_wizard.dart` или existing OEM hint widget (поискать через grep `Xiaomi\|HyperOS`)

- [ ] **Step 11.1: Найти существующий OEM hint widget**

```bash
grep -rn "Xiaomi\|HyperOS\|MIUI\|HiOS\|MagicOS" apps/mobile-child/lib/
```

В CLAUDE.md упомянут `apps/mobile-child/lib/features/permissions/` — там скорее всего есть OEM-step или battery_step с OEM-инструкциями.

- [ ] **Step 11.2: Дополнить инструкции для микрофона**

Если есть существующий `battery_step.dart` или `oem_hints_step.dart` — добавь упоминание про микрофон в инструкции:

> **Xiaomi/HyperOS 2+:**  
> Для функции «Звук вокруг ребёнка»: Карточка приложения → ⋮ → «Разрешить ограниченные настройки» → «Контроль активности» → «Без ограничений» → «Автозапуск» → ON.  
> Без этого FGS микрофона может быть убит системой при экономии батареи.

> **Honor MagicOS:**  
> «Запуск приложений» → найти gmd_child → ручное управление → Автозапуск + Запуск в фоне + Запуск других приложений → все ON.

> **Samsung OneUI:**  
> Без батарейных ограничений (это уже было для location). Для микрофона дополнительно нет действий.

Если такого step ещё нет — создать `oem_hints_step.dart` со стандартным OEM-handling по детектированию модели.

- [ ] **Step 11.3: Commit**

```bash
git add apps/mobile-child/lib/features/permissions/
git commit -m "feat(mobile-child): OEM-wizard инструкции для «Звук вокруг» (Xiaomi/HyperOS, Honor)"
```

---

### Task 12: Build full APK + manual install + smoke-test

**Files:** none (только проверки)

- [ ] **Step 12.1: Release-сборка**

```bash
cd apps/mobile-child
/d/flutter/bin/flutter build apk --release --split-per-abi
```

Expected: 3 APK в `build/app/outputs/flutter-apk/` (arm64-v8a, armeabi-v7a, x86_64).

- [ ] **Step 12.2: Установить на тестовое устройство**

Если есть Android-устройство в adb:

```bash
adb install -r build/app/outputs/flutter-apk/app-arm64-v8a-release.apk
```

(Если нет физического устройства — пропустить smoke-test, отметить в report.)

- [ ] **Step 12.3: Manual smoke-test**

1. Открыть mobile-child, дойти до permission wizard, дать `RECORD_AUDIO` permission.
2. На backend (через psql или существующий admin UI) — вручную создать `device_commands` строку с `type='START_AUDIO'`, payload с реальной TURN-cred (можно сгенерить через POST /audio/sessions от parent).
3. На устройстве проверить в DiagLog (long-press на версии в /debug):
   - `START_AUDIO sessionId=...`
   - `SoundAround start sessionId=...`
   - `SoundAround READY отправлен`
4. На устройстве проверить:
   - В status bar появился foreground notification «Сервис активен»
   - Системный privacy indicator (зелёная точка справа сверху) отображается
5. На backend — проверить, что `audio_sessions` запись перешла из PENDING в READY.

Если не получается воспроизвести — отметить в report как `manual_test_skipped`, переходить к Task 13.

- [ ] **Step 12.4: Commit (нет изменений если только manual проверка)**

Skip commit если код не менялся.

---

### Task 13: Версия + CHANGELOG + release

**Files:**

- Modify: `package.json` (root)
- Modify: `CHANGELOG.md`

- [ ] **Step 13.1: Bump version**

```bash
cd D:\Project\GMD
npm version 0.33.0 --no-git-tag-version --workspaces=false
pnpm version:sync
pnpm version:check
```

Expected: все package.json и pubspec.yaml = 0.33.0. mobile-child build number (`+N`) инкрементируется отдельно перед релизной сборкой:

```bash
# Прочитать текущий +N в pubspec.yaml mobile-child и инкрементировать вручную
# (например 0.33.0+38 → 0.33.0+39)
```

- [ ] **Step 13.2: CHANGELOG**

Добавь блок СВЕРХУ:

```markdown
## v0.33.0 — 2026-04-23

### Новые возможности

- **«Звук вокруг ребёнка» — mobile-child** — реализована Android-сторона аудиомониторинга. Native `SoundAroundService` (FGS типа `microphone`, требование Android 14+) поднимается по `START_AUDIO` команде из существующего poll'а DeviceCommand'ов. Headless FlutterEngine в сервисе через `flutter_webrtc` создаёт `RTCPeerConnection`, захватывает микрофон с echo-cancellation/noise-suppression/AGC, отправляет SDP-offer и ICE-кандидаты на backend через `/child/audio/sessions/:id/{ready,ice}`. Auto-stop по `durationSec` или явной `STOP_AUDIO` команде. Hidden-mode по умолчанию: ребёнку не показываются push/баннеры, но system-level privacy indicator Android (зелёная точка) появляется автоматически и не может быть скрыт. Permission-wizard расширен шагом для `RECORD_AUDIO`. OEM-инструкции для Xiaomi/HyperOS, Honor MagicOS обновлены — без них FGS микрофона может быть убит при экономии батареи.

### Изменения

- chore: добавлен `flutter_webrtc ^0.11.7` в pubspec mobile-child
- chore: новые файлы — `lib/features/sound_around/`, `lib/core/native/sound_around_channel.dart`, `lib/core/api/audio_api.dart`, native `SoundAroundService.kt`
- chore: AndroidManifest — `RECORD_AUDIO` + `FOREGROUND_SERVICE_MICROPHONE` permissions, declare сервис с `foregroundServiceType="microphone"`

### Известные ограничения (по spec'у)

- SDP-answer от parent на child пока приходит через… **TBD** (см. Task 8.2 footnote — Plan A не пушит answer на child через DeviceCommand, нужен новый command type `AUDIO_ANSWER` или separate poll endpoint). Без этого fix'а child не сможет завершить WebRTC-handshake. Этот gap должен быть закрыт в Plan A v0.32.1 ИЛИ в начале Plan C при работе над parent-side.
- iOS не поддерживается (mobile-child Android-only на MVP).
```

- [ ] **Step 13.3: Tests + final verify**

```bash
cd D:\Project\GMD
pnpm version:check
cd apps/mobile-child
/d/flutter/bin/flutter analyze
/d/flutter/bin/flutter test
```

Expected: все clean / PASS.

- [ ] **Step 13.4: Commit + tag**

```bash
cd D:\Project\GMD
git add -A
git commit -m "chore: release v0.33.0 — «Звук вокруг» mobile-child Android (Plan B)"
git tag v0.33.0
```

---

## Self-Review Checklist (для имплементатора перед PR)

- [ ] `pnpm version:check` PASS
- [ ] `flutter analyze` zero issues
- [ ] `flutter test` все unit + widget PASS
- [ ] APK собирается release без warnings про missing permissions
- [ ] Если есть физ-устройство: установка APK + DiagLog ловит START_AUDIO команду + SoundAroundService поднимается
- [ ] AndroidManifest содержит RECORD_AUDIO + FOREGROUND_SERVICE_MICROPHONE + declared service
- [ ] CHANGELOG обновлён с known limitation про SDP answer

## Open Questions / Risks

1. **CRITICAL: SDP-answer delivery to child.** Plan A не пушит `parent.answer` SDP на child. Без этого WebRTC handshake не завершается на child-стороне. Решения:
   - **(a)** Добавить новый command type `AUDIO_ANSWER` с payload `{sessionId, sdp}` в Plan A backend (`AudioService.parentAnswer` дополнительно вызывает `commands.enqueueAudioAnswer`). Минимальное изменение, требует **отдельного PR в Plan A** (например v0.32.1) ДО того как Plan B будет полезен end-to-end.
   - **(b)** GET `/child/audio/sessions/:id/answer` polling endpoint, child poll'ит каждую секунду. Добавляется в Plan A.

   **Рекомендация:** (a) в Plan A v0.32.1 — это минут 30 работы, и Plan B сразу станет полностью функционален.

2. **flutter_webrtc + Android 14 FOREGROUND_SERVICE_TYPE_MICROPHONE.** На устройствах с Android 14+ требуется явный manifest declaration (Task 2 покрывает). Но flutter_webrtc плагин **сам** запрашивает audio focus + audio session — нужно убедиться, что плагин совместим с FGS-microphone. Проверить через тест на реальном Android 14 устройстве (Task 12).

3. **Headless FlutterEngine + flutter_webrtc** — нужно проверить, что плагин корректно работает в background isolate. `DartPluginRegistrant.ensureInitialized()` — обязателен (Task 7). Если плагин не работает — fallback к (b) в архитектурном вопросе #2: native Kotlin WebRTC с pure-Kotlin signaling.

4. **OEM-bypass:** Xiaomi/HyperOS могут убить FGS даже с правильным declaration — это известная проблема (см. v0.31.2 в memory). Mitigation: OEM-wizard (Task 11) + честно документировать в README что некоторые OEM могут не работать без battery-whitelist.

5. **`apps/mobile-child/.env` или Env.apiBaseUrl** — sound_around_controller.dart использует `Env.apiBaseUrl`. Проверь, что это уже настроено (вероятно да, location_ingestor использует то же).

6. **Тестирование в Windows-dev:** APK нужно собирать локально через `flutter build apk` (есть `flutter` в `D:\flutter\bin`, см. CLAUDE.md). Установка на устройство — через adb. Если adb не настроен — собирать на CI / реальном устройстве позже.

---

**Plan summary:** 13 tasks, ~50 шагов, оценка 4-6 рабочих дней (опытный Flutter-developer + знание native Android FGS). КРИТИЧНО: перед началом необходимо решить Open Question #1 (SDP-answer delivery) — иначе end-to-end не заработает.
