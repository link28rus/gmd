import '../core/api/api_exceptions.dart';
import '../core/api/child_api.dart';
import '../core/diag/diag_channel.dart';
import '../data/database.dart';
import '../data/location_queue_repository.dart';

/// Точки из нативного сервиса геолокации → локальная очередь → сервер.
///
/// v0.59.0 — офлайн-режим. Точка удаляется из очереди только когда сервер её
/// принял или явно отверг как некорректную. Сеть недоступна, 5xx или 429 —
/// точки остаются в очереди, а следующая попытка откладывается с нарастающей
/// паузой ([backoffSteps]): без интернета телефон не стучится в сеть на каждую
/// новую точку, а просто пишет её в базу. Появилась сеть
/// ([onConnectivityRestored]) — пауза сбрасывается, очередь выгружается
/// пачками подряд, от старых точек к новым (сервер считает геозоны и поездки
/// в хронологическом порядке).
class LocationIngestor {
  LocationIngestor({
    required this.repo,
    required this.api,
    required this.deviceToken,
    this.onUnauthorized,
    this.onCommand,
    DateTime Function()? clock,
  }) : _now = clock ?? DateTime.now;
  final LocationQueueRepository repo;
  final ChildApi api;
  final Future<String?> Function() deviceToken;
  // Вызывается когда backend отвечает 401/403 на ingest — устройство
  // отозвано (родитель удалил ребёнка / сбросил девайс). Реализация
  // обычно чистит secure storage и стопает foreground сервис.
  final Future<void> Function()? onUnauthorized;
  // Вызывается при каждой pending команде. Возвращаемый Future резолвится
  // когда команда реально выполнена — только тогда шлём ack на сервер,
  // чтобы при падении воспроизведения команда осталась pending и была
  // переотправлена при следующем poll.
  final Future<void> Function(DeviceCommand cmd)? onCommand;
  final DateTime Function() _now;

  /// Размер пачки. Совпадает с MAX_BATCH_SIZE на сервере; если сервер
  /// ответит 413 (старая версия с лимитом 100), размер уменьшается.
  static const int maxBatchSize = 500;

  /// Сколько пачек выгружать за один проход. Сервер пускает 20 запросов в
  /// минуту на устройство: 8 пачек и пауза [drainCooldown] укладываются в
  /// лимит. 8 × 500 = 4000 точек ≈ 5,5 часа движения.
  static const int maxBatchesPerFlush = 8;
  static const Duration drainCooldown = Duration(seconds: 30);

  /// Пауза перед следующей попыткой после N-й неудачи подряд.
  static const List<Duration> backoffSteps = [
    Duration(seconds: 15),
    Duration(seconds: 30),
    Duration(minutes: 1),
    Duration(minutes: 2),
    Duration(minutes: 5),
  ];

  /// Лимиты очереди: ~50 тыс. точек (≈10 МБ) — больше суток непрерывного
  /// движения; старше 7 суток сервер точки не примет.
  static const int maxQueueSize = 50000;
  static const Duration maxQueueAge = Duration(days: 7);
  static const int _trimEvery = 200;

  DateTime _lastFlush = DateTime.fromMillisecondsSinceEpoch(0);
  bool _firstFlushed = false;
  bool _flushing = false;
  int _failures = 0;
  DateTime? _retryAfter;
  int _batchSize = maxBatchSize;
  int _sinceTrim = _trimEvery;

  bool get _inBackoff {
    final until = _retryAfter;
    return until != null && _now().isBefore(until);
  }

  Future<void> onLocation(Map<String, dynamic> payload) async {
    final lat = (payload['lat'] as num).toDouble();
    final lon = (payload['lon'] as num).toDouble();
    if (!lat.isFinite || !lon.isFinite) {
      diagLog('ingestor', 'point DROPPED: non-finite lat/lon');
      return;
    }
    await repo.enqueue(
      lat: lat,
      lon: lon,
      accuracy: (payload['accuracy'] as num?)?.toDouble(),
      altitude: (payload['altitude'] as num?)?.toDouble(),
      speed: (payload['speed'] as num?)?.toDouble(),
      bearing: (payload['bearing'] as num?)?.toDouble(),
      batteryLevel: payload['batteryLevel'] as int?,
      isCharging: payload['isCharging'] as bool?,
      provider: payload['provider'] as String?,
      networkType: payload['networkType'] as String?,
      mobileOperator: payload['mobileOperator'] as String?,
      recordedAt: DateTime.fromMillisecondsSinceEpoch(
        (payload['recordedAt'] as num).toInt(),
      ),
    );
    await _trimIfDue();
    // Без сети точка уже лежит в базе — сеть не трогаем до конца паузы.
    if (_inBackoff) return;
    final count = await repo.count();
    final age = _now().difference(_lastFlush);
    // Первую локацию флашим сразу. Дальше — near-realtime: батчим по 2
    // точки или раз в 20с, чтобы родитель видел движение почти вживую
    // без перегрева rate-limit.
    if (!_firstFlushed || count >= 2 || age > const Duration(seconds: 20)) {
      _firstFlushed = true;
      await flushQueue();
    }
  }

  /// Сеть снова доступна — сбросить паузу и сразу выгрузить очередь.
  Future<void> onConnectivityRestored() async {
    if (_failures > 0 || _retryAfter != null) {
      diagLog(
        'ingestor',
        'connectivity restored → backoff reset (failures=$_failures)',
      );
    }
    _failures = 0;
    _retryAfter = null;
    await flushQueue();
  }

  Future<void> flushQueue() async {
    if (_flushing || _inBackoff) return;
    _flushing = true;
    try {
      _lastFlush = _now();
      final token = await deviceToken();
      if (token == null) return;
      final delivered = await _drain(token);
      // Команды забираем только когда сервер отвечает: без сети запрос
      // всё равно упадёт. Основной канал команд — WebSocket (v0.57),
      // этот poll — запасной.
      if (delivered) await _pollCommands(token);
    } finally {
      _flushing = false;
    }
  }

  /// Выгрузить очередь пачками. true — сервер доступен (очередь пуста или
  /// выгружена до лимита прохода), false — отправка сорвалась, включена пауза
  /// или устройство отозвано.
  Future<bool> _drain(String token) async {
    for (var i = 0; i < maxBatchesPerFlush; i++) {
      final batch = await repo.takeBatch(limit: _batchSize);
      if (batch.isEmpty) return true;
      try {
        await _send(batch, token);
      } on UnauthorizedException {
        // Устройство отозвано сервером. Не ретраим, очищаем очередь и
        // сообщаем наверх — при следующем открытии приложения home увидит
        // пустой токен и уведёт на /onboarding.
        await repo.deleteIds(batch.map((r) => r.id).toList());
        if (onUnauthorized != null) {
          await onUnauthorized!();
        }
        return false;
      } catch (e) {
        _scheduleRetry(e, queued: await repo.count());
        return false;
      }
      if (_failures > 0) {
        diagLog('ingestor', 'delivery restored after $_failures failures');
      }
      _failures = 0;
      _retryAfter = null;
      if (batch.length < _batchSize) return true;
    }
    // Хвост большой — дадим серверному rate-limit остыть, остаток уйдёт
    // следующим проходом.
    _retryAfter = _now().add(drainCooldown);
    diagLog(
      'ingestor',
      'drain: pass limit reached, queue=${await repo.count()}',
    );
    return true;
  }

  /// Отправить пачку. Если сервер отверг её как некорректную (400), делим
  /// пополам, пока не найдём конкретную плохую точку: выбрасывается только
  /// она, остальные доходят. 413 — пачка больше серверного лимита.
  Future<void> _send(List<PendingLocation> rows, String token) async {
    try {
      await api.ingestLocations(
        rows.map(_toPoint).toList(),
        deviceToken: token,
      );
      await repo.deleteIds(rows.map((r) => r.id).toList());
    } on BatchTooLargeException {
      if (rows.length == 1) rethrow;
      _batchSize = (rows.length ~/ 2).clamp(1, maxBatchSize);
      diagLog('ingestor', 'batch too large → batch size $_batchSize');
      await _sendHalves(rows, token);
    } on BadRequestIngestException {
      if (rows.length == 1) {
        diagLog(
          'ingestor',
          'point rejected by server (400) → dropped, recordedAt=${rows.first.recordedAt.toIso8601String()}',
        );
        await repo.deleteIds([rows.first.id]);
        return;
      }
      await _sendHalves(rows, token);
    }
  }

  Future<void> _sendHalves(List<PendingLocation> rows, String token) async {
    final mid = rows.length ~/ 2;
    await _send(rows.sublist(0, mid), token);
    await _send(rows.sublist(mid), token);
  }

  void _scheduleRetry(Object error, {required int queued}) {
    final step = backoffSteps[_failures.clamp(0, backoffSteps.length - 1)];
    _failures++;
    _retryAfter = _now().add(step);
    // Лог только на первом сбое и на выходе на максимальную паузу — без сети
    // это событие повторяется часами.
    if (_failures == 1 || _failures == backoffSteps.length) {
      diagLog(
        'ingestor',
        'delivery failed ($error), queue=$queued, retry in ${step.inSeconds}s',
      );
    }
  }

  Future<void> _trimIfDue() async {
    if (++_sinceTrim < _trimEvery) return;
    _sinceTrim = 0;
    final expired = await repo.deleteOlderThan(_now().subtract(maxQueueAge));
    if (expired > 0) {
      diagLog('ingestor', 'queue: dropped $expired points older than 7 days');
    }
    await repo.trimOverflow(maxSize: maxQueueSize);
  }

  static LocationPoint _toPoint(PendingLocation r) => LocationPoint(
    lat: r.lat,
    lon: r.lon,
    accuracy: r.accuracy,
    altitude: r.altitude,
    speed: r.speed,
    bearing: r.bearing,
    batteryLevel: r.batteryLevel,
    isCharging: r.isCharging,
    provider: r.provider,
    networkType: r.networkType,
    mobileOperator: r.mobileOperator,
    recordedAt: r.recordedAt,
  );

  Future<void> _pollCommands(String token) async {
    if (onCommand == null) return;
    List<DeviceCommand> commands;
    try {
      commands = await api.getPendingCommands(deviceToken: token);
    } on UnauthorizedException {
      if (onUnauthorized != null) {
        await onUnauthorized!();
      }
      return;
    } catch (e) {
      diagLog('ingestor', 'getPendingCommands failed: $e');
      return;
    }
    for (final cmd in commands) {
      try {
        await onCommand!(cmd);
        await api.ackCommand(deviceToken: token, commandId: cmd.id);
        diagLog('ingestor', 'command ${cmd.type} ${cmd.id} executed+acked');
      } catch (e) {
        // Не acked — сервер отдаст команду в следующий поллинг. expiresAt
        // на сервере (5 мин) защитит от бесконечного перепривода.
        diagLog('ingestor', 'command ${cmd.id} failed: $e');
      }
    }
  }
}
