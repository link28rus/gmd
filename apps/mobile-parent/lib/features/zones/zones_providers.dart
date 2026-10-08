import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/device/device_channel.dart';
import '../../core/providers.dart';
import 'zone_models.dart';
import 'zones_repository.dart';

final zonesRepositoryProvider = Provider<ZonesRepository>(
  (ref) => ZonesRepository(ref.watch(dioProvider)),
);

/// Зоны семьи. Держится в памяти (экран зон, карта ребёнка, лента берут одно и
/// то же). Refresh: `ref.invalidate(zonesListProvider)`. Смена пользователя
/// (выход → вход другим) перезапрашивает — чужие зоны не показываем.
final zonesListProvider = FutureProvider<List<Zone>>((ref) async {
  ref.watch(authSessionProvider.select((s) => s?.user.id));
  return ref.watch(zonesRepositoryProvider).list();
});

/// Последние точки всех детей (и родителей, v0.70.0) семьи одним запросом.
final familyLatestProvider = FutureProvider.autoDispose<FamilyLatest>((ref) async {
  return ref.watch(zonesRepositoryProvider).familyLatest();
});

/// IANA-пояс телефона — для расписания и срока (уходит при каждом сохранении).
final deviceTimeZoneProvider = FutureProvider<String?>((_) => DeviceChannel.timeZone());

/// Подсказки мест (этап 4). Ошибку экран не показывает — секция просто
/// скрывается (старый backend отвечает 404). Обновлять вместе с зонами:
/// новая зона закрывает подсказку, удалённая — может вернуть.
final zoneSuggestionsProvider =
    FutureProvider.autoDispose<List<PlaceSuggestion>>((ref) async {
  final tz = await ref.watch(deviceTimeZoneProvider.future);
  return ref.watch(zonesRepositoryProvider).suggestions(tz: tz);
});

/// Статистика визитов в зону за 30 дней. После правки зоны —
/// `ref.invalidate(zoneStatsProvider)`.
final zoneStatsProvider =
    FutureProvider.autoDispose.family<ZoneStats, String>((ref, zoneId) async {
  final tz = await ref.watch(deviceTimeZoneProvider.future);
  return ref.watch(zonesRepositoryProvider).stats(zoneId, tz: tz);
});

/// Фильтр ленты. Record — equatable по значению, годится ключом family.
typedef ZoneEventsFilter = ({String? childId, String? zoneId});

@immutable
class ZoneEventsState {
  const ZoneEventsState({
    this.items = const [],
    this.nextCursor,
    this.loading = false,
    this.loadingMore = false,
    this.error,
    this.loadMoreError,
  });

  final List<ZoneEvent> items;
  final String? nextCursor;

  /// Первая страница грузится.
  final bool loading;
  final bool loadingMore;

  /// Ошибка первой страницы.
  final Object? error;

  /// Ошибка «показать ещё» — уже загруженное не прячем.
  final Object? loadMoreError;

  bool get hasMore => nextCursor != null;
}

/// Лента событий с курсором: первая страница при создании, «показать ещё»
/// дописывает следующую.
class ZoneEventsController extends StateNotifier<ZoneEventsState> {
  ZoneEventsController(this._repo, this.filter)
      : super(const ZoneEventsState(loading: true)) {
    refresh();
  }

  final ZonesRepository _repo;
  final ZoneEventsFilter filter;
  int _generation = 0;

  Future<void> refresh() async {
    final gen = ++_generation;
    state = ZoneEventsState(loading: true, items: state.items);
    try {
      final page = await _repo.events(childId: filter.childId, zoneId: filter.zoneId);
      if (!mounted || gen != _generation) return;
      state = ZoneEventsState(items: page.items, nextCursor: page.nextCursor);
    } catch (e) {
      if (!mounted || gen != _generation) return;
      state = ZoneEventsState(error: e);
    }
  }

  Future<void> loadMore() async {
    final cursor = state.nextCursor;
    if (cursor == null || state.loadingMore || state.loading) return;
    final gen = _generation;
    state = ZoneEventsState(
      items: state.items,
      nextCursor: cursor,
      loadingMore: true,
    );
    try {
      final page = await _repo.events(
        childId: filter.childId,
        zoneId: filter.zoneId,
        cursor: cursor,
      );
      if (!mounted || gen != _generation) return;
      state = ZoneEventsState(
        items: [...state.items, ...page.items],
        nextCursor: page.nextCursor,
      );
    } catch (e) {
      if (!mounted || gen != _generation) return;
      state = ZoneEventsState(items: state.items, nextCursor: cursor, loadMoreError: e);
    }
  }
}

final zoneEventsProvider = StateNotifierProvider.autoDispose
    .family<ZoneEventsController, ZoneEventsState, ZoneEventsFilter>(
  (ref, filter) => ZoneEventsController(ref.watch(zonesRepositoryProvider), filter),
);
