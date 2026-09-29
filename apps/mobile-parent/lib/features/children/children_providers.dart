import 'dart:typed_data';

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

/// Активный трек (точки + стоянки текущей поездки). Если ребёнок стоит —
/// пустые списки.
final childActiveTrackProvider =
    FutureProvider.autoDispose.family<TrackData, String>((ref, childId) async {
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

/// Точки и стоянки конкретной поездки (для polyline и маркеров на карте).
final tripPointsProvider =
    FutureProvider.autoDispose.family<TrackData, TripPointsKey>((ref, key) async {
  final repo = ref.watch(childrenRepositoryProvider);
  return repo.tripPoints(key.childId, key.tripId);
});

/// Ключ для [childAvatarPhotoProvider] — (childId, version из `photo:<version>`).
/// Новая версия фото = новый ключ → старые байты не показываются.
typedef ChildAvatarPhotoKey = ({String childId, String version});

/// Байты фото ребёнка. Успешный результат держится в памяти (keepAlive): одно
/// и то же фото рисуется на главной, в карточке статуса и в маркере — грузим
/// один раз на версию. Ошибка (404, сеть) не кэшируется навсегда: provider
/// освобождается без слушателей и при следующем показе пробует снова.
/// Пока грузится или при ошибке виджет показывает букву имени.
final childAvatarPhotoProvider = FutureProvider.autoDispose
    .family<Uint8List, ChildAvatarPhotoKey>((ref, key) async {
  final repo = ref.watch(childrenRepositoryProvider);
  final bytes = await repo.fetchAvatarPhoto(key.childId);
  ref.keepAlive();
  return bytes;
});
