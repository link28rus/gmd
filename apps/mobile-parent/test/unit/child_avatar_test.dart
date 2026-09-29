import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/features/children/child_models.dart';
import 'package:periscop_parent/features/children/widgets/child_avatar.dart';
import 'package:periscop_parent/features/children/widgets/child_avatar_sheet.dart';

void main() {
  group('ChildAvatarKey.parse', () {
    test('null → буква', () => expect(ChildAvatarKey.parse(null), isNull));

    test('preset:fox → presetId', () {
      final k = ChildAvatarKey.parse('preset:fox');
      expect(k?.presetId, 'fox');
      expect(k?.photoVersion, isNull);
    });

    test('неизвестный пресет → буква', () {
      expect(ChildAvatarKey.parse('preset:dragon'), isNull);
    });

    test('photo:<version> → photoVersion', () {
      final k = ChildAvatarKey.parse('photo:0123456789ab');
      expect(k?.photoVersion, '0123456789ab');
      expect(k?.presetId, isNull);
    });

    test('пустая версия и мусор → буква', () {
      expect(ChildAvatarKey.parse('photo:'), isNull);
      expect(ChildAvatarKey.parse('garbage'), isNull);
    });

    test('для каждого пресета есть SVG в assets', () {
      for (final id in ChildAvatarKey.presets) {
        expect(File(ChildAvatarKey.presetAsset(id)).existsSync(), isTrue,
            reason: id);
      }
    });
  });

  test('Child.fromJson читает avatarKey', () {
    final c = Child.fromJson({'id': 'c1', 'name': 'Аня', 'avatarKey': 'preset:owl'});
    expect(c.avatarKey, 'preset:owl');
    final c2 = Child.fromJson({'id': 'c2', 'name': 'Петя', 'avatarKey': null});
    expect(c2.avatarKey, isNull);
    final c3 = Child.fromJson({'id': 'c3', 'name': 'Петя'});
    expect(c3.avatarKey, isNull);
  });

  group('detectAvatarMime', () {
    Uint8List b(List<int> x) => Uint8List.fromList(x);

    test('JPEG', () => expect(detectAvatarMime(b([0xFF, 0xD8, 0xFF, 0xE0])), 'image/jpeg'));
    test('PNG', () => expect(detectAvatarMime(b([0x89, 0x50, 0x4E, 0x47, 0x0D])), 'image/png'));
    test('WebP', () {
      final riff = [...'RIFF'.codeUnits, 0, 0, 0, 0, ...'WEBP'.codeUnits];
      expect(detectAvatarMime(b(riff)), 'image/webp');
    });
    test('RIFF без WEBP (WAV) → null', () {
      final wav = [...'RIFF'.codeUnits, 0, 0, 0, 0, ...'WAVE'.codeUnits];
      expect(detectAvatarMime(b(wav)), isNull);
    });
    test('HEIC/GIF/короткий → null', () {
      expect(detectAvatarMime(b('GIF89a'.codeUnits)), isNull);
      expect(detectAvatarMime(b([0, 0, 0, 0x18, ...'ftypheic'.codeUnits])), isNull);
      expect(detectAvatarMime(b([0xFF])), isNull);
    });
  });

  group('ChildAvatar', () {
    Widget wrap(Widget w) =>
        ProviderScope(child: MaterialApp(home: Scaffold(body: Center(child: w))));

    testWidgets('без avatarKey — переданный fallback', (tester) async {
      await tester.pumpWidget(wrap(ChildAvatar(
        name: 'Аня',
        childId: 'c1',
        avatarKey: null,
        size: 48,
        fallback: (_) => const Text('FALLBACK'),
      )));
      expect(find.text('FALLBACK'), findsOneWidget);
    });

    testWidgets('без avatarKey и fallback — буква имени', (tester) async {
      await tester.pumpWidget(wrap(const ChildAvatar(
        name: 'аня',
        childId: 'c1',
        avatarKey: null,
        size: 40,
      )));
      expect(find.text('А'), findsOneWidget);
    });

    testWidgets('preset — SVG из assets', (tester) async {
      await tester.pumpWidget(wrap(const ChildAvatar(
        name: 'Аня',
        childId: 'c1',
        avatarKey: 'preset:fox',
        size: 48,
      )));
      await tester.pumpAndSettle();
      expect(find.byType(SvgPicture), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
