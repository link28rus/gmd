import 'package:flutter_test/flutter_test.dart';
import 'package:periscop_parent/features/children/permission_state.dart';

void main() {
  test('старый backend и отсутствие отчёта не превращаются в ОК', () {
    expect(PermissionState.fromJson({}).status, 'unknown');
    expect(PermissionState.fromJson({}).summary, contains('Нет отчёта'));
  });
  test('свежее состояние само становится устаревшим после 18 часов', () {
    final s = PermissionState.fromJson({
      'status': 'ok',
      'reportedAt': '2026-11-17T00:00:00Z',
      'missing': [],
    });
    expect(s.isStaleAt(DateTime.parse('2026-11-17T17:00:00Z')), false);
    expect(s.isStaleAt(DateTime.parse('2026-11-18T00:00:00Z')), true);
  });
  test('сохраняет читаемые названия отключённых функций', () {
    final s = PermissionState.fromJson({
      'status': 'degraded',
      'reportedAt': DateTime.now().toUtc().toIso8601String(),
      'missing': [
        {'key': 'microphone', 'label': 'Микрофон'},
      ],
    });
    expect(s.missing, ['Микрофон']);
    expect(s.summary, contains('Микрофон'));
  });
}
