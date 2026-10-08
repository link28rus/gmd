import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/core/parent_location/parent_location_channel.dart';
import 'package:periscop_parent/features/zones/zone_models.dart';

void main() {
  group('FamilyLatest.fromJson', () {
    test('старый сервер без parents — пустой список родителей', () {
      final r = FamilyLatest.fromJson({
        'items': [
          {'childId': 'c1', 'lat': 55.1, 'lon': 37.2, 'accuracy': 12, 'ageSec': 30},
        ],
      });
      expect(r.items, hasLength(1));
      expect(r.items.single.childId, 'c1');
      expect(r.items.single.accuracy, 12);
      expect(r.parents, isEmpty);
    });

    test('parents: isMe, имя, давность, точность', () {
      final r = FamilyLatest.fromJson({
        'items': <Object>[],
        'parents': [
          {
            'userId': 'u1',
            'name': 'Мама',
            'lat': 55.0,
            'lon': 37.0,
            'accuracy': 25.5,
            'recordedAt': '2026-10-08T10:00:00.000Z',
            'ageSec': 700,
            'isMe': true,
          },
          {'userId': 'u2', 'name': 'Папа', 'lat': 56, 'lon': 38, 'accuracy': null, 'ageSec': 5},
        ],
      });
      expect(r.items, isEmpty);
      expect(r.parents, hasLength(2));
      final me = r.parents.first;
      expect(me.isMe, isTrue);
      expect(me.name, 'Мама');
      expect(me.ageSec, 700);
      expect(me.accuracy, 25.5);
      expect(me.recordedAt, isNotNull);
      final other = r.parents.last;
      expect(other.isMe, isFalse);
      expect(other.accuracy, isNull);
      expect(other.lat, 56.0);
    });

    test('не Map — пустой ответ', () {
      expect(FamilyLatest.fromJson(null).items, isEmpty);
      expect(FamilyLatest.fromJson('x').parents, isEmpty);
    });
  });

  group('ParentLocationNativeStatus.fromMap', () {
    test('разбор статуса службы', () {
      final s = ParentLocationNativeStatus.fromMap({
        'running': true,
        'hasToken': true,
        'enabled': true,
        'authFailed': false,
        'buffered': 3,
        'lastUploadAtMs': 1759917600000,
        'lastError': null,
      });
      expect(s.running, isTrue);
      expect(s.buffered, 3);
      expect(s.lastUploadAt, isNotNull);
    });

    test('мусор — неизвестный статус', () {
      final s = ParentLocationNativeStatus.fromMap(null);
      expect(s.running, isFalse);
      expect(s.lastUploadAt, isNull);
    });
  });
}
