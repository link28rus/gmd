import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/push/live_location_push.dart';
import '../children/child_models.dart';
import '../children/children_providers.dart';
import '../map/family_map.dart';
import '../zones/zone_models.dart';
import '../zones/zones_providers.dart';

/// Карта семьи на главном экране (v0.70.0) — только просмотр: дети, родители,
/// геозоны. Нажатие на ребёнка — его экран.
///
/// Живое обновление (по образцу экрана ребёнка), пока главный экран сверху и
/// приложение на переднем плане: раз в 30 с `PUT /family/locations/watch`
/// (одним запросом на всех детей) + опрос `GET /family/locations/latest`;
/// тихий push о новой точке любого ребёнка — обновление с паузой ~1,5 с,
/// чтобы пачка push'ей дала один запрос. Ушли на другой экран (экран ребёнка,
/// геозоны) или свернули приложение — таймеры стоят.
class HomeFamilyMap extends ConsumerStatefulWidget {
  const HomeFamilyMap({super.key});

  @override
  ConsumerState<HomeFamilyMap> createState() => _HomeFamilyMapState();
}

class _HomeFamilyMapState extends ConsumerState<HomeFamilyMap> with WidgetsBindingObserver {
  static const _pollInterval = Duration(seconds: 30);
  static const _pushDebounce = Duration(milliseconds: 1500);

  final FamilyMapController _map = FamilyMapController();
  Timer? _poll;
  Timer? _debounce;
  StreamSubscription<String>? _pushSub;

  bool _routeCurrent = true;
  bool _appResumed = true;
  bool _active = false;

  // Первое включение: точки уже грузятся (провайдер только что создан) —
  // перезапрашивать незачем, нужна только отметка «смотрю».
  bool _first = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final state = WidgetsBinding.instance.lifecycleState;
    _appResumed = state == null || state == AppLifecycleState.resumed;
    _pushSub = LiveLocationPush.childUpdates.listen((_) => _onPush());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Главный экран перекрыт другим маршрутом (/home/child/:id, геозоны,
    // диалог) — isCurrent = false, зависимость пересчитается при возврате.
    _routeCurrent = ModalRoute.isCurrentOf(context) ?? true;
    _updateActive();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _appResumed = true;
    } else if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _appResumed = false;
    } else {
      return; // inactive / detached — не трогаем
    }
    _updateActive();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _debounce?.cancel();
    _pushSub?.cancel();
    super.dispose();
  }

  void _updateActive() {
    final next = _routeCurrent && _appResumed;
    if (next == _active) return;
    _active = next;
    if (next) {
      _markWatching();
      if (_first) {
        _first = false;
      } else {
        _refreshLatest();
      }
      _poll?.cancel();
      _poll = Timer.periodic(_pollInterval, (_) => _tick());
    } else {
      _poll?.cancel();
      _poll = null;
      _debounce?.cancel();
      _debounce = null;
    }
  }

  void _tick() {
    if (!_active || !mounted) return;
    _markWatching();
    _refreshLatest();
  }

  void _onPush() {
    if (!_active || !mounted) return;
    _debounce?.cancel();
    _debounce = Timer(_pushDebounce, () {
      if (_active && mounted) _refreshLatest();
    });
  }

  /// «Смотрю карту семьи» — сервер шлёт тихие push о новых точках детей.
  /// Ошибку (нет сети, старый сервер без эндпоинта) глотаем: карта всё равно
  /// обновляется опросом.
  void _markWatching() {
    ref.read(zonesRepositoryProvider).watchFamilyLocations().catchError((Object _) {});
  }

  void _refreshLatest() => ref.invalidate(familyLatestProvider);

  @override
  Widget build(BuildContext context) {
    final zonesAsync = ref.watch(zonesListProvider);
    final latestAsync = ref.watch(familyLatestProvider);
    final kids = ref.watch(childrenListProvider).valueOrNull ?? const <Child>[];

    final zones = zonesAsync.valueOrNull ?? const <Zone>[];
    final latest = latestAsync.valueOrNull ?? FamilyLatest.empty;
    final zonesDone = zonesAsync.hasValue || zonesAsync.hasError;
    final latestDone = latestAsync.hasValue || latestAsync.hasError;

    return FamilyMap(
      controller: _map,
      zones: zones,
      points: latest.items,
      parents: latest.parents,
      kidById: {for (final k in kids) k.id: k},
      dataReady: zonesDone && latestDone,
      heroTagPrefix: 'home',
      onKidTap: (kid, _) => context.push('/home/child/${kid.id}'),
    );
  }
}
