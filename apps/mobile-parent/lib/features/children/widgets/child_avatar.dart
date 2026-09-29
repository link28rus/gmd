import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../child_models.dart';
import '../children_providers.dart';

/// Аватар ребёнка: своё фото / стандартный зверёк / буква имени.
///
/// Круг диаметром [size]. Буква (fallback) у каждого места своя — на главной
/// цвет зависит от online-статуса, в маркере карты — зелёный круг. Поэтому
/// место вызова передаёт [fallback]; без него рисуется буква на цвете,
/// стабильном по имени (как в web `avatarColor`).
///
/// Фото грузится через Dio под JWT родителя ([childAvatarPhotoProvider]),
/// пока грузится или при ошибке — fallback. Online-точку рисует вызывающий.
class ChildAvatar extends ConsumerWidget {
  const ChildAvatar({
    super.key,
    required this.name,
    required this.childId,
    required this.avatarKey,
    required this.size,
    this.fallback,
  });

  final String name;
  final String childId;
  final String? avatarKey;
  final double size;
  final WidgetBuilder? fallback;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final parsed = ChildAvatarKey.parse(avatarKey);
    final presetId = parsed?.presetId;
    final version = parsed?.photoVersion;

    Widget buildFallback(BuildContext ctx) =>
        fallback?.call(ctx) ?? ChildLetterAvatar(name: name, size: size);

    Widget content;
    if (presetId != null) {
      content = SvgPicture.asset(
        ChildAvatarKey.presetAsset(presetId),
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholderBuilder: buildFallback,
      );
    } else if (version != null) {
      final photo = ref.watch(
        childAvatarPhotoProvider((childId: childId, version: version)),
      );
      final bytes = photo.value;
      if (bytes == null) return buildFallback(context);
      content = Image.memory(
        bytes,
        width: size,
        height: size,
        fit: BoxFit.cover,
        gaplessPlayback: true,
        // Декодируем под размер на экране, а не 512×512 на каждый маркер.
        cacheWidth: (size * MediaQuery.devicePixelRatioOf(context)).round(),
        errorBuilder: (ctx, _, _) => buildFallback(ctx),
      );
    } else {
      return buildFallback(context);
    }

    return SizedBox(
      width: size,
      height: size,
      child: ClipOval(child: content),
    );
  }
}

/// Буква имени на цветном круге (цвет стабилен по имени, как в web).
/// Fallback [ChildAvatar] по умолчанию — раньше жил в `ChildStatusCard._Avatar`.
class ChildLetterAvatar extends StatelessWidget {
  const ChildLetterAvatar({super.key, required this.name, this.size = 40});

  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: colorFor(name),
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        firstLetter(name),
        style: TextStyle(
          color: Colors.white,
          fontSize: size * 0.4,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  static String firstLetter(String name) {
    final t = name.trim();
    if (t.isEmpty) return '?';
    return t.characters.first.toUpperCase();
  }

  /// Простой стабильный цвет на основе имени — как в web `avatarColor`.
  static Color colorFor(String name) {
    if (name.isEmpty) return const Color(0xFF64748B);
    int hash = 0;
    for (final ch in name.codeUnits) {
      hash = (hash * 31 + ch) & 0x7FFFFFFF;
    }
    const palette = <int>[
      0xFF2563EB, // blue
      0xFF7C3AED, // violet
      0xFFDB2777, // pink
      0xFFE11D48, // rose
      0xFFEA580C, // orange
      0xFFCA8A04, // amber
      0xFF16A34A, // green
      0xFF0891B2, // cyan
      0xFF0D9488, // teal
    ];
    return Color(palette[hash % palette.length]);
  }
}
