import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';

/// Адрес ближайшего дома к точке («Игнатьевское шоссе, 1») или null, если
/// рядом адресов нет.
///
/// Ключ — `reverseKey(lat, lon)` из trip_history_logic.dart («lon,lat», ~10 м).
/// Тот же серверный `GET /api/geocode?reverse=lon,lat`, что у веб-кабинета:
/// Yandex HTTP Геокодер, ключ только на сервере, там же кэш.
///
/// Удачный ответ держим до конца сессии приложения (keepAlive) — дом и школа
/// не перезапрашиваются при каждом открытии экрана. Ошибка (нет сети, квота,
/// 503 без ключа) живёт, пока открыт экран, — при следующем открытии запрос
/// повторится.
final reversePlaceProvider =
    FutureProvider.autoDispose.family<String?, String>((ref, key) async {
  final dio = ref.watch(dioProvider);
  final res = await dio.get<dynamic>('/geocode', queryParameters: {'reverse': key});
  ref.keepAlive();
  final data = res.data;
  if (data is! Map) return null;
  final items = data['items'];
  if (items is! List || items.isEmpty) return null;
  final name = (items.first as Map)['name'];
  return name is String && name.isNotEmpty ? name : null;
});
