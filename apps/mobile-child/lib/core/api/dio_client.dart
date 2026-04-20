import 'package:dio/dio.dart';

Dio buildDio({required String baseUrl, String? deviceToken}) {
  final dio = Dio(BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 10),
    sendTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 15),
    headers: {'Content-Type': 'application/json'},
  ));
  if (deviceToken != null) {
    dio.options.headers['Authorization'] = 'Bearer $deviceToken';
  }
  return dio;
}
