sealed class ApiException implements Exception {
  const ApiException(this.message);
  final String message;
  @override
  String toString() => '$runtimeType: $message';
}

class InvalidCodeException extends ApiException {
  const InvalidCodeException() : super('Код не найден или истёк');
}

// У ребёнка уже есть подключённый телефон (409 child_has_device). Новый можно
// привязать только после сброса старого в кабинете родителя.
class ChildHasDeviceException extends ApiException {
  const ChildHasDeviceException()
      : super('К ребёнку уже подключён другой телефон. Попросите родителя '
            'сбросить устройство в кабинете и создать новый код.');
}

// Ребёнку 14+, а согласие при создании кода не отмечено
// (400 consent14plus_required).
class Consent14PlusRequiredException extends ApiException {
  const Consent14PlusRequiredException()
      : super('Ребёнку 14 лет или больше — нужно его согласие. Попросите '
            'родителя создать новый код и отметить согласие.');
}

class NetworkException extends ApiException {
  const NetworkException(super.message);
}

class ServerException extends ApiException {
  const ServerException(super.message, this.statusCode);
  final int statusCode;
}

class BadRequestIngestException extends ApiException {
  const BadRequestIngestException() : super('Invalid batch');
}

// 413 на приёме точек — пачка больше серверного лимита (MAX_BATCH_SIZE).
// Точки не удаляем: ingestor уменьшит пачку и отправит заново.
class BatchTooLargeException extends ApiException {
  const BatchTooLargeException() : super('Batch too large');
}

class TooManyRequestsException extends ApiException {
  const TooManyRequestsException([String? message])
      : super(message ?? 'Слишком часто. Подождите немного.');
}

// Устройство отвязано на стороне сервера (родитель сбросил или удалил
// ребёнка). Клиент должен очистить deviceToken и показать экран привязки —
// старый токен больше не работает.
class UnauthorizedException extends ApiException {
  const UnauthorizedException() : super('Устройство отвязано');
}
