import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'child_models.dart';

/// v0.80.0: ключ SharedPreferences выбора «Как записано».
const kTrackViewPrefsKey = 'track_view';

/// v0.80.0: вид трека на картах (активная поездка и история) — по дорогам
/// (по умолчанию) или «как записано». Выбор один на все экраны и детей,
/// хранится в SharedPreferences.
///
/// Async, а не StateNotifier с умолчанием, как у темы: провайдеры трека
/// ждут сохранённое значение (`ref.watch(trackViewProvider.future)`) —
/// иначе при сохранённом «как записано» трек при открытии экрана
/// запрашивался бы дважды (сначала по дорогам, потом заново).
class TrackViewController extends AsyncNotifier<TrackView> {
  @override
  Future<TrackView> build() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return decode(prefs.getString(kTrackViewPrefsKey));
    } catch (_) {
      // не критично — остаёмся на умолчании
      return TrackView.road;
    }
  }

  /// Установить и сохранить вид трека. Провайдеры трека перезапросят данные.
  Future<void> setView(TrackView view) async {
    state = AsyncData(view);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(kTrackViewPrefsKey, view.apiValue);
    } catch (_) {
      // не сохранилось — выбор действует до перезапуска
    }
  }

  static TrackView decode(String? raw) =>
      raw == TrackView.recorded.apiValue ? TrackView.recorded : TrackView.road;
}

/// Текущий вид трека. Читается в [childActiveTrackProvider] и
/// [tripPointsProvider], меняется пунктом «Как записано» в меню экранов
/// карты ребёнка и истории передвижений (`TrackViewMenuButton`).
final trackViewProvider = AsyncNotifierProvider<TrackViewController, TrackView>(
  TrackViewController.new,
);
