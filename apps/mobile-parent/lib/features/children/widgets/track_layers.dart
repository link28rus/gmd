import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../child_models.dart';
import '../track_gaps.dart';

const _kTrackColor = Color(0xFF2E7D32);
const _kGapColor = Color(0xFF757575);
const _kGapLabelColor = Color(0xFF616161);

// Не const: в flutter_map 7.0.2 assert конструктора читает `segments.length`.
final _kGapPattern = StrokePattern.dashed(segments: const [8, 6]);

/// Слои трека ребёнка для `FlutterMap.children`:
///   - непрерывные куски — сплошной зелёной линией (как раньше);
///   - разрывы (см. [splitTrackByGaps]) — тонким серым пунктиром;
///   - у середины каждого разрыва — подпись «нет данных N мин».
///
/// Вставлять через spread ниже маркеров: `...buildTrackLayers(points)`.
/// Упрощение линии (`simplificationTolerance` в [PolylineLayer]) работает
/// по каждой [Polyline] отдельно, то есть по кускам, а не через разрыв.
List<Widget> buildTrackLayers(List<ChildLocation> points) {
  if (points.length < 2) return const [];
  final split = splitTrackByGaps(points);
  return [
    PolylineLayer(
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
    if (split.gaps.isNotEmpty)
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
  ];
}

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
