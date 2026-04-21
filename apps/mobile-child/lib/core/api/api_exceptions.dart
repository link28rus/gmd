sealed class ApiException implements Exception {
  const ApiException(this.message);
  final String message;
  @override
  String toString() => '$runtimeType: $message';
}

class InvalidCodeException extends ApiException {
  const InvalidCodeException() : super('Код не найден или истёк');
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
