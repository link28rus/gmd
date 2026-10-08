import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/diag/diag_channel.dart';
import '../../core/providers.dart';
import 'consent_repository.dart';

final consentRepositoryProvider = Provider<ConsentRepository>(
  (ref) => ConsentRepository(ref.watch(dioProvider)),
);

/// id пользователя, которому нужно принять политику (null — не нужно).
/// Пока совпадает с пользователем сессии, роутер держит его на `/consent`
/// (см. redirect в app_router.dart). Привязка к id — чтобы флаг одного
/// аккаунта не сработал после выхода и входа под другим.
final consentPendingUserProvider = StateProvider<String?>((_) => null);

/// Сколько ждём `GET /me` при входе. Дольше — пускаем без проверки:
/// сеть не должна блокировать вход (изменения тогда ответят
/// `consent_required`, и экран откроется оттуда).
const _meTimeout = Duration(seconds: 6);

/// После входа / восстановления сессии: `/consent`, если сервер требует
/// принять политику, иначе `/home`. Ошибка или таймаут `GET /me` → `/home`.
Future<String> routeAfterSignIn(WidgetRef ref) async {
  final userId = ref.read(authSessionProvider)?.user.id;
  if (userId == null) return '/home';
  try {
    final info = await ref.read(consentRepositoryProvider).fetch().timeout(_meTimeout);
    ref.read(consentPendingUserProvider.notifier).state = info.requiresConsent ? userId : null;
    if (info.requiresConsent) {
      unawaited(diagLog('consent', 'required, policy ${info.currentPolicyVersion}'));
      return '/consent';
    }
  } catch (e) {
    unawaited(diagLog('consent', 'GET /me failed, skip: $e'));
  }
  return '/home';
}

/// Ответ `consent_required` на действие: отметить, что нужно согласие, —
/// роутер откроет экран принятия политики. true — это была такая ошибка.
bool markConsentRequired(WidgetRef ref, Object error) {
  if (!isConsentRequiredError(error)) return false;
  final userId = ref.read(authSessionProvider)?.user.id;
  if (userId != null) ref.read(consentPendingUserProvider.notifier).state = userId;
  return true;
}
