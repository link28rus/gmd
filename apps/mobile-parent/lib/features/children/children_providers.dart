import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import 'child_models.dart';
import 'children_repository.dart';

final childrenRepositoryProvider = Provider<ChildrenRepository>(
  (ref) => ChildrenRepository(ref.watch(dioProvider)),
);

/// Список детей текущего родителя. Refresh: `ref.invalidate(childrenListProvider)`.
final childrenListProvider = FutureProvider<List<Child>>((ref) async {
  final repo = ref.watch(childrenRepositoryProvider);
  return repo.list();
});

/// Последняя локация ребёнка по id. autoDispose: освобождается при выходе с экрана.
final childLatestLocationProvider =
    FutureProvider.autoDispose.family<ChildLocation?, String>((ref, childId) async {
  final repo = ref.watch(childrenRepositoryProvider);
  return repo.latestLocation(childId);
});

/// Активный трек (точки текущей поездки). Если ребёнок стоит — пустой массив.
final childActiveTrackProvider =
    FutureProvider.autoDispose.family<List<ChildLocation>, String>((ref, childId) async {
  final repo = ref.watch(childrenRepositoryProvider);
  return repo.activeTrack(childId);
});

/// Список поездок ребёнка (история передвижений). autoDispose — освобождается
/// при выходе с экрана истории. Refresh: `ref.invalidate(childTripsProvider(id))`.
final childTripsProvider =
    FutureProvider.autoDispose.family<List<Trip>, String>((ref, childId) async {
  final repo = ref.watch(childrenRepositoryProvider);
  return repo.listTrips(childId);
});

/// Ключ для [tripPointsProvider] — пара (childId, tripId). Record-тип
/// автоматически equatable по значению → корректная мемоизация family.
typedef TripPointsKey = ({String childId, String tripId});

/// Точки маршрута конкретной поездки (для polyline на карте).
final tripPointsProvider =
    FutureProvider.autoDispose.family<List<ChildLocation>, TripPointsKey>((ref, key) async {
  final repo = ref.watch(childrenRepositoryProvider);
  return repo.tripPoints(key.childId, key.tripId);
});
