// Temporary stub — реальная реализация в Task 8.
typedef StopRequestCallback = void Function({String? reason});

class SoundAroundController {
  SoundAroundController({required this.onStopRequest});

  final StopRequestCallback onStopRequest;

  Future<void> start({
    required String sessionId,
    required Map<String, dynamic> turnCreds,
    required int durationSec,
  }) async {}

  Future<void> stop({String? reason}) async {
    onStopRequest(reason: reason);
  }
}
