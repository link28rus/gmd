import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:flutter_rustore_push/pigeons/rustore_push.dart';
import 'package:periscop_parent/core/push/push_deeplink.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'холодный RuStore tap ждёт восстановления сессии, открытый UI получает его сразу',
    () {
      PushDeepLinkChannel.prepareStartup();
      final opened = <PushDeepLink>[];
      PushDeepLinkChannel.listen(opened.add);
      const link = PushDeepLink(
        type: 'PERMISSION_DEGRADED',
        childId: 'child-test',
      );
      PushDeepLinkChannel.openExternal(link);
      expect(opened, isEmpty);
      expect(
        PushDeepLinkChannel.completeStartup()?.route,
        '/home/child/child-test',
      );
      expect(PushDeepLinkChannel.completeStartup(), isNull);
      PushDeepLinkChannel.openExternal(link);
      expect(opened, [link]);
    },
  );
  test(
    'получает cold-start сообщение через настоящий Pigeon API RuStore',
    () async {
      const channel = BasicMessageChannel<Object?>(
        'dev.flutter.pigeon.flutter_rustore_push.RuStorePush.getInitialMessage',
        RuStorePush.pigeonChannelCodec,
      );
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockDecodedMessageHandler<Object?>(
            channel,
            (_) async => [
              Message(
                priority: 1,
                ttl: 300,
                data: {'type': 'PERMISSION_DEGRADED', 'childId': 'cold-child'},
              ),
            ],
          );
      try {
        final link = await PushDeepLinkChannel.takeRuStoreInitial();
        expect(link?.route, '/home/child/cold-child');
      } finally {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockDecodedMessageHandler<Object?>(channel, null);
      }
    },
  );
}
