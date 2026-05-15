import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { FcmService } from '../fcm/fcm.service';
import { ParentDevicesService } from '../parent-devices/parent-devices.service';
import type { ChildAuthContext } from '../child-device/child-device.service';
import type { SosDto } from './dto/sos.dto';

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailerService) private readonly mailer: MailerService,
    @Inject(FcmService) private readonly fcm: FcmService,
    @Inject(ParentDevicesService) private readonly parentDevices: ParentDevicesService,
  ) {}

  async create(ctx: ChildAuthContext, dto: SosDto): Promise<{ sosId: string; createdAt: string }> {
    const event = await this.prisma.sosEvent.create({
      data: {
        childId: ctx.childId,
        childDeviceId: ctx.deviceId,
        lat: dto.lat,
        lon: dto.lon,
        accuracy: dto.accuracy,
        recordedAt: new Date(dto.recordedAt),
        message: dto.message,
      },
    });

    // Fetch family + parent emails, send SOS mail + FCM push.
    // Failures are logged but do NOT throw — event is already persisted.
    try {
      const family = await this.prisma.family.findFirst({
        where: { children: { some: { id: ctx.childId } } },
        include: { memberships: { include: { user: true } } },
      });
      if (family) {
        const emails = family.memberships
          .map((m) => m.user.email)
          .filter((e): e is string => Boolean(e));
        for (const to of emails) {
          try {
            await this.mailer.send({
              to,
              subject: 'SOS от ребёнка',
              text: `Ребёнок ${ctx.childName} отправил SOS.\nКоординаты: ${dto.lat}, ${dto.lon}\nОткрыть: https://gmd.link28rus.ru/cabinet`,
            });
          } catch (err) {
            this.logger.error(`Failed to email SOS to ${to.slice(0, 3)}***: ${String(err)}`);
          }
        }

        // v0.46: FCM push на parent-devices.
        const devices = await this.parentDevices.findActiveByFamilyId(family.id);
        if (devices.length > 0) {
          const data: Record<string, string> = {
            type: 'SOS',
            childId: ctx.childId,
            childName: ctx.childName,
            sosId: event.id,
            lat: String(dto.lat),
            lon: String(dto.lon),
            recordedAt: dto.recordedAt,
          };
          await Promise.all(
            devices.map((d) =>
              this.fcm.sendHybridToToken({
                tokens: { fcmToken: d.fcmToken, rustorePushToken: d.rustorePushToken },
                data,
                label: `SOS child=${ctx.childId}`,
                onInvalidFcmToken: (token) => this.parentDevices.clearTokenByExpired(token),
                onInvalidRustoreToken: (token) => this.parentDevices.clearRustoreByExpired(token),
              }),
            ),
          );
        }
      }
    } catch (err) {
      this.logger.error(`SOS notify pipeline failed (event already saved): ${String(err)}`);
    }

    return {
      sosId: event.id,
      createdAt: event.serverCreatedAt.toISOString(),
    };
  }
}
