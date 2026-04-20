import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/api/api_exceptions.dart';
import '../../core/api/child_api.dart';
import '../../core/storage/secure_storage_service.dart';
import '../claim/claim_controller.dart';

enum SosStatus { idle, sending, success, error }

class SosState {
  const SosState({required this.status, this.errorMessage, this.sosId});
  final SosStatus status;
  final String? errorMessage;
  final String? sosId;
}

/// Async position lookup. Injectable so unit tests don't hit the
/// geolocator platform channel.
typedef PositionLocator = Future<Position> Function();

Future<Position> _defaultLocator() => Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 10),
      ),
    );

final positionLocatorProvider =
    Provider<PositionLocator>((_) => _defaultLocator);

final sosControllerProvider =
    StateNotifierProvider<SosController, SosState>(
  (ref) => SosController(
    api: ref.watch(childApiProvider),
    storage: ref.watch(secureStorageProvider),
    locate: ref.watch(positionLocatorProvider),
  ),
);

class SosController extends StateNotifier<SosState> {
  SosController({
    required ChildApi api,
    required SecureStorageService storage,
    required PositionLocator locate,
  })  : _api = api,
        _storage = storage,
        _locate = locate,
        super(const SosState(status: SosStatus.idle));

  final ChildApi _api;
  final SecureStorageService _storage;
  final PositionLocator _locate;

  Future<void> send() async {
    // Guard against double-taps while a send is already in flight.
    if (state.status == SosStatus.sending) return;
    state = const SosState(status: SosStatus.sending);

    try {
      final token = await _storage.readDeviceToken();
      if (!mounted) return;
      if (token == null || token.isEmpty) {
        state = const SosState(
          status: SosStatus.error,
          errorMessage: 'Устройство не привязано к семье.',
        );
        return;
      }

      final position = await _locate();
      if (!mounted) return;

      final resp = await _api.sendSos(
        deviceToken: token,
        lat: position.latitude,
        lon: position.longitude,
        accuracy: position.accuracy,
        recordedAt: DateTime.now().toUtc(),
      );
      if (!mounted) return;
      state = SosState(status: SosStatus.success, sosId: resp.sosId);
    } on TooManyRequestsException catch (e) {
      if (!mounted) return;
      state = SosState(status: SosStatus.error, errorMessage: e.message);
    } on ApiException catch (e) {
      if (!mounted) return;
      state = SosState(status: SosStatus.error, errorMessage: e.message);
    } catch (_) {
      if (!mounted) return;
      state = const SosState(
        status: SosStatus.error,
        errorMessage: 'Не удалось отправить SOS. Попробуйте ещё раз.',
      );
    }
  }

  void reset() => state = const SosState(status: SosStatus.idle);
}
