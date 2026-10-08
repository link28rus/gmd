import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/diag/diag_channel.dart';

/// «Где я» — местоположение телефона родителя. Разрешение спрашиваем только
/// по нажатию (спека 3.1), точность грубая (LocationAccuracy.low): нужен
/// район, чтобы поставить зону рядом, а не метры. С v0.70.0 в манифесте есть
/// и FINE (фоновая передача местоположения родителя), поэтому системный
/// диалог предложит выбор «точное / приблизительное». Все отказы — понятным
/// текстом в SnackBar, без падений. null — показать нечего.
Future<LatLng?> locateMe(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  void say(String text, {SnackBarAction? action}) {
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text), action: action));
  }

  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      say(
        'Геолокация на телефоне выключена — включите её, чтобы показать, где вы.',
        action: SnackBarAction(
          label: 'Включить',
          onPressed: () => Geolocator.openLocationSettings(),
        ),
      );
      return null;
    }

    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.denied) {
      say('Без доступа к местоположению не показать, где вы. '
          'Разрешение можно дать при следующем нажатии.');
      return null;
    }
    if (perm == LocationPermission.deniedForever) {
      say(
        'Доступ к местоположению запрещён в настройках приложения.',
        action: SnackBarAction(
          label: 'Настройки',
          onPressed: () => Geolocator.openAppSettings(),
        ),
      );
      return null;
    }

    say('Определяем, где вы…');
    Position? pos;
    try {
      pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.low,
          timeLimit: Duration(seconds: 15),
        ),
      );
    } on TimeoutException {
      pos = await Geolocator.getLastKnownPosition();
    }
    if (pos == null) {
      say('Не удалось определить местоположение — попробуйте ещё раз чуть позже.');
      return null;
    }
    messenger.hideCurrentSnackBar();
    return LatLng(pos.latitude, pos.longitude);
  } catch (e) {
    unawaited(diagLog('zones', 'locateMe failed: $e'));
    say('Не удалось определить местоположение — попробуйте ещё раз чуть позже.');
    return null;
  }
}

/// Точка «я» на карте.
class MyLocationDot extends StatelessWidget {
  const MyLocationDot({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 18,
      height: 18,
      decoration: BoxDecoration(
        color: const Color(0xFF1E88E5),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 4),
        ],
      ),
    );
  }
}
