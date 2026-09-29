import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../child_models.dart';
import '../track_gaps.dart';

const _kTrackColor = Color(0xFF2E7D32);
const _kGapColor = Color(0xFF757575);
const _kGapLabelColor = Color(0xFF616161);
// Маркер стоянки — как в web-кабинете (amber-500 / amber-50 / amber-700).
const _kStayBorderColor = Color(0xFFF59E0B);
const _kStayFillColor = Color(0xFFFFFBEB);
const _kStayTextColor = Color(0xFFB45309);

// Не const: в flutter_map 7.0.2 assert конструктора читает `segments.length`.
final _kGapPattern = StrokePattern.dashed(segments: const [8, 6]);

/// Слои трека ребёнка для `FlutterMap.children`:
///   - непрерывные куски — сплошной зелёной линией (как раньше);
///   - разрывы (см. [splitTrackByGaps]) — тонким серым пунктиром;
///   - у середины каждого разрыва — подпись «нет данных N мин»;
///   - стоянки ([stays], сервер v0.63.0+) — кружки «П», по тапу подсказка
///     «Стоял HH:MM–HH:MM · N мин».
///
/// Вставлять через spread ДО маркера ребёнка/концов поездки: слои рисуются
/// в порядке списка, так стоянки окажутся под ними.
///
/// Линию сервер уже очистил, упростил и сгладил, поэтому встроенное
/// упрощение flutter_map выключено (`simplificationTolerance: 0`) — иначе
/// оно срезает углы на поворотах.
List<Widget> buildTrackLayers(
  List<ChildLocation> points, {
  List<TrackStay> stays = const [],
}) {
  final hasLine = points.length >= 2;
  if (!hasLine && stays.isEmpty) return const [];
  final split = hasLine ? splitTrackByGaps(points) : null;
  return [
    if (split != null)
      PolylineLayer(
        simplificationTolerance: 0,
        polylines: [
          // Пунктир первым — сплошные куски рисуются поверх него.
          for (final gap in split.gaps)
            Polyline(
              points: [_latLng(gap.from), _latLng(gap.to)],
              strokeWidth: 2,
              color: _kGapColor,
              pattern: _kGapPattern,
            ),
          for (final segment in split.segments)
            if (segment.length >= 2)
              Polyline(
                points: segment.map(_latLng).toList(),
                strokeWidth: 4,
                color: _kTrackColor,
                borderStrokeWidth: 1,
                borderColor: Colors.white,
              ),
        ],
      ),
    if (split != null && split.gaps.isNotEmpty)
      MarkerLayer(
        markers: [
          for (final gap in split.gaps)
            Marker(
              point: LatLng(
                (gap.from.lat + gap.to.lat) / 2,
                (gap.from.lon + gap.to.lon) / 2,
              ),
              width: 160,
              height: 24,
              child: _GapLabel(text: formatTrackGapLabel(gap.duration)),
            ),
        ],
      ),
    if (stays.isNotEmpty)
      MarkerLayer(
        markers: [
          for (final stay in stays)
            Marker(
              key: ValueKey('stay-${stay.from.millisecondsSinceEpoch}'),
              point: LatLng(stay.lat, stay.lon),
              // Кружок 20dp, но зона тапа 32dp — в маленький не попасть.
              width: 32,
              height: 32,
              child: _StayMarker(label: formatTrackStayLabel(stay)),
            ),
        ],
      ),
  ];
}

/// «Стоял 13:05–13:20 · 15 мин» — формат как у web-кабинета
/// (`apps/web/components/locations/track-polyline.tsx`).
String formatTrackStayLabel(TrackStay stay) {
  final total = stay.duration.inSeconds <= 0
      ? 0
      : (stay.duration.inSeconds / 60).round();
  final hours = total ~/ 60;
  final minutes = total % 60;
  final String dur;
  if (hours == 0) {
    dur = '$minutes мин';
  } else if (minutes == 0) {
    dur = '$hours ч';
  } else {
    dur = '$hours ч $minutes мин';
  }
  return 'Стоял ${_hhmm(stay.from)}–${_hhmm(stay.to)} · $dur';
}

String _hhmm(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

LatLng _latLng(ChildLocation p) => LatLng(p.lat, p.lon);

class _GapLabel extends StatelessWidget {
  const _GapLabel({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      // scaleDown — чтобы при крупном системном шрифте подпись не вылезла
      // за рамки маркера.
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.92),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: _kGapColor.withValues(alpha: 0.6)),
          ),
          child: Text(
            text,
            maxLines: 1,
            softWrap: false,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: _kGapLabelColor,
            ),
          ),
        ),
      ),
    );
  }
}

class _StayMarker extends StatelessWidget {
  const _StayMarker({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: label,
      triggerMode: TooltipTriggerMode.tap,
      showDuration: const Duration(seconds: 4),
      // Прозрачный фон — чтобы тап ловился по всей зоне 32dp, а не только
      // по кружку.
      child: ColoredBox(
        color: Colors.transparent,
        child: Center(
          child: Container(
            width: 20,
            height: 20,
            decoration: BoxDecoration(
              color: _kStayFillColor,
              shape: BoxShape.circle,
              border: Border.all(color: _kStayBorderColor, width: 2),
            ),
            alignment: Alignment.center,
            // scaleDown — при крупном системном шрифте буква не вылезет
            // за кружок.
            child: const FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                'П',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: _kStayTextColor,
                  height: 1,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
