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
