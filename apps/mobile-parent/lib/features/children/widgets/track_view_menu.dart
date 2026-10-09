import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../child_models.dart';
import '../track_view_provider.dart';

/// v0.80.0: меню «⋮» в AppBar экранов с треком (карта ребёнка, история
/// передвижений) с пунктом «Как записано» — трек без привязки к дорогам.
/// Выбор общий для обоих экранов ([trackViewProvider]).
///
/// Пока включено «как записано» (не умолчание), на кнопке меню точка —
/// иначе непонятно, почему трек не по дорогам.
class TrackViewMenuButton extends ConsumerWidget {
  const TrackViewMenuButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final viewAsync = ref.watch(trackViewProvider);
    final recorded = viewAsync.valueOrNull == TrackView.recorded;
    return PopupMenuButton<TrackView>(
      tooltip: 'Вид трека',
      icon: Badge(
        isLabelVisible: recorded,
        smallSize: 8,
        child: const Icon(Icons.more_vert),
      ),
      onSelected: (view) =>
          ref.read(trackViewProvider.notifier).setView(view),
      itemBuilder: (context) => [
        CheckedPopupMenuItem<TrackView>(
          // Выбор пункта переключает: включено → по дорогам.
          value: recorded ? TrackView.road : TrackView.recorded,
          checked: recorded,
          enabled: viewAsync.hasValue,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Как записано'),
              const SizedBox(height: 2),
              Text(
                'Трек без привязки к дорогам',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ],
    );
  }
}
