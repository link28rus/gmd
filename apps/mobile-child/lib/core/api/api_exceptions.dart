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
