/// Унифицированное исключение для UI: статус + код ошибки + сообщение.
class ApiException implements Exception {
  ApiException({required this.status, this.code, this.message});

  final int status;
  final String? code;
  final String? message;

  bool get isUnauthorized => status == 401;
  bool get isRateLimited => status == 429;

  @override
  String toString() => 'ApiException($status${code != null ? ', $code' : ''})'
      '${message != null ? ': $message' : ''}';
}
