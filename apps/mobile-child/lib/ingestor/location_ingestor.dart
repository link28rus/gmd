import '../core/api/api_exceptions.dart';
import '../core/api/child_api.dart';
import '../core/diag/diag_channel.dart';
import '../data/location_queue_repository.dart';

class LocationIngestor {
  LocationIngestor({
    required this.repo,
    required this.api,
    required this.deviceToken,
    this.onUnauthorized,
    this.onCommand,
  });
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

  DateTime _lastFlush = DateTime.fromMillisecondsSinceEpoch(0);
  bool _firstFlushed = false;

  Future<void> onLocation(Map<String, dynamic> payload) async {
    await repo.enqueue(
      lat: (payload['lat'] as num).toDouble(),
      lon: (payload['lon'] as num).toDouble(),
      accuracy: (payload['accuracy'] as num?)?.toDouble(),
      altitude: (payload['altitude'] as num?)?.toDouble(),
      speed: (payload['speed'] as num?)?.toDouble(),
      bearing: (payload['bearing'] as num?)?.toDouble(),
      batteryLevel: payload['batteryLevel'] as int?,
      isCharging: payload['isCharging'] as bool?,
      provider: payload['provider'] as String?,
      networkType: payload['networkType'] as String?,
      wifiSsid: payload['wifiSsid'] as String?,
      mobileOperator: payload['mobileOperator'] as String?,
      recordedAt: DateTime.fromMillisecondsSinceEpoch(
        (payload['recordedAt'] as num).toInt(),
      ),
    );
    await repo.trimOverflow(maxSize: 10000);
    final count = await repo.count();
    final age = DateTime.now().difference(_lastFlush);
    // Первую локацию флашим сразу. Дальше — near-realtime: батчим по 2
    // точки или раз в 20с, чтобы родитель видел движение почти вживую
    // без перегрева rate-limit.
    if (!_firstFlushed || count >= 2 || age > const Duration(seconds: 20)) {
      _firstFlushed = true;
      await flushQueue();
    }
  }

  Future<void> flushQueue() async {
    _lastFlush = DateTime.now();
    final token = await deviceToken();
    if (token == null) return;
    final batch = await repo.takeBatch(limit: 100);
    if (batch.isNotEmpty) {
      try {
        await api.ingestLocations(
          batch
              .map((r) => LocationPoint(
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
                    wifiSsid: r.wifiSsid,
                    mobileOperator: r.mobileOperator,
                    recordedAt: r.recordedAt,
                  ))
              .toList(),
          deviceToken: token,
        );
        await repo.deleteIds(batch.map((r) => r.id).toList());
      } on UnauthorizedException {
        // Устройство отозвано сервером. Не ретраим, очищаем очередь и
        // сообщаем наверх — при следующем открытии приложения home увидит
        // пустой токен и уведёт на /onboarding.
        await repo.deleteIds(batch.map((r) => r.id).toList());
        if (onUnauthorized != null) {
          await onUnauthorized!();
        }
        return;
      } on BadRequestIngestException {
        await repo.deleteIds(batch.map((r) => r.id).toList());
      } catch (_) {
        await repo.markRetry(batch.map((r) => r.id).toList());
      }
    }
    // После ingest забираем pending команды. Делаем это каждый flush, а не
    // только когда batch непустой: если очередь пуста (редкий случай), но
    // команда ждёт — должны её забрать всё равно.
    await _pollCommands(token);
  }

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
