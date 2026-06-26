import 'package:flutter_test/flutter_test.dart';
import 'package:gmd_child/ingestor/retry_policy.dart';

void main() {
  const p = RetryPolicy(maxAttempts: 5);

  test('canRetry returns true under max', () {
    expect(p.canRetry(0), isTrue);
    expect(p.canRetry(4), isTrue);
    expect(p.canRetry(5), isFalse);
  });

  test('nextDelay exponential', () {
    expect(p.nextDelay(1).inSeconds, 2);
    expect(p.nextDelay(2).inSeconds, 4);
    expect(p.nextDelay(3).inSeconds, 8);
    expect(p.nextDelay(10).inSeconds, lessThanOrEqualTo(300)); // cap 5min
  });
}
