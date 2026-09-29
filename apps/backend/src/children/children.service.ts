import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CHILD_AVATAR_MAX_BYTES, SetChildAvatarSchema } from './dto/set-child-avatar.dto';
import type { ChildAvatarMime } from './dto/set-child-avatar.dto';

export interface ChildAvatarPhotoBytes {
  mime: string;
  sha256: string;
  data: Buffer;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
/** Максимальная длина base64-строки, которая может уложиться в лимит после декодирования. */
const MAX_BASE64_LEN = Math.ceil(CHILD_AVATAR_MAX_BYTES / 3) * 4;

function invalidAvatar(message: string): BadRequestException {
  return new BadRequestException({ code: 'invalid_avatar', message });
}

/** Сигнатура файла должна совпадать с заявленным mime (сервер не перекодирует). */
function matchesSignature(mime: ChildAvatarMime, b: Buffer): boolean {
  switch (mime) {
    case 'image/jpeg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'image/webp':
      return (
        b.length >= 12 &&
        b.toString('latin1', 0, 4) === 'RIFF' &&
        b.toString('latin1', 8, 12) === 'WEBP'
      );
    default:
      return false;
  }
}

export interface ProtectionState {
  enabled: boolean;
  enabledAt: Date | null;
  enabledBy: string | null;
}

export interface CreateChildInput {
  name: string;
  dateOfBirth?: Date;
}

export interface UpdateChildInput {
  name?: string;
  dateOfBirth?: Date;
}

@Injectable()
export class ChildrenService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createChild(familyId: string, input: CreateChildInput) {
    return this.prisma.child.create({
      data: {
        familyId,
        name: input.name,
        dateOfBirth: input.dateOfBirth,
      },
    });
  }

  async listChildren(familyId: string): Promise<
    Array<{
      id: string;
      name: string;
      dateOfBirth: Date | null;
      avatarKey: string | null;
      protectionEnabled: boolean;
      protectionEnabledAt: Date | null;
      device: {
        id: string;
        deviceName: string | null;
        osVersion: string | null;
        appVersion: string | null;
        lastSeenAt: Date | null;
        revokedAt: Date | null;
      } | null;
    }>
  > {
    type Row = {
      id: string;
      name: string;
      dateOfBirth: Date | null;
      avatarKey: string | null;
      protectionEnabled: boolean;
      protectionEnabledAt: Date | null;
      device: {
        id: string;
        deviceName: string | null;
        osVersion: string | null;
        appVersion: string | null;
        lastSeenAt: Date | null;
        revokedAt: Date | null;
      } | null;
    };
    const rows = (await this.prisma.child.findMany({
      where: { familyId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { device: true },
    })) as Row[];
    return rows.map((c: Row) => ({
      id: c.id,
      name: c.name,
      dateOfBirth: c.dateOfBirth,
      avatarKey: c.avatarKey ?? null,
      protectionEnabled: c.protectionEnabled,
      protectionEnabledAt: c.protectionEnabledAt,
      device: c.device
        ? {
            id: c.device.id,
            deviceName: c.device.deviceName,
            osVersion: c.device.osVersion,
            appVersion: c.device.appVersion,
            lastSeenAt: c.device.lastSeenAt,
            revokedAt: c.device.revokedAt,
          }
        : null,
    }));
  }

  async getChildInFamily(familyId: string, childId: string) {
    return this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null },
    });
  }

  async updateChild(familyId: string, childId: string, patch: UpdateChildInput) {
    const existing = await this.getChildInFamily(familyId, childId);
    if (!existing) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    return this.prisma.child.update({
      where: { id: childId },
      data: { name: patch.name, dateOfBirth: patch.dateOfBirth },
    });
  }

  /// Аватар ребёнка (v0.61): пресет или своё фото. `raw` — тело PUT, валидируется здесь,
  /// чтобы ошибки имели коды из контракта (`invalid_avatar` 400, `avatar_too_large` 413).
  /// Фото и `avatarKey` пишутся в одной транзакции.
  async setAvatar(familyId: string, childId: string, raw: unknown): Promise<{ avatarKey: string }> {
    const parsed = SetChildAvatarSchema.safeParse(raw);
    if (!parsed.success) {
      throw invalidAvatar('Expected exactly one of {preset} or {photo: {mime, base64}}');
    }
    const input = parsed.data;

    if ('preset' in input) {
      await this.requireChild(familyId, childId);
      const avatarKey = `preset:${input.preset}`;
      await this.prisma.$transaction(async (tx) => {
        await tx.childAvatarPhoto.deleteMany({ where: { childId } });
        await tx.child.update({ where: { id: childId }, data: { avatarKey } });
      });
      return { avatarKey };
    }

    const { mime, base64 } = input.photo;
    if (base64.length > MAX_BASE64_LEN) {
      throw new PayloadTooLargeException({
        code: 'avatar_too_large',
        message: `Photo exceeds ${CHILD_AVATAR_MAX_BYTES} bytes`,
      });
    }
    if (!BASE64_RE.test(base64)) throw invalidAvatar('Photo is not valid base64');
    const data = Buffer.from(base64, 'base64');
    if (data.length === 0) throw invalidAvatar('Photo is empty');
    if (data.length > CHILD_AVATAR_MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'avatar_too_large',
        message: `Photo exceeds ${CHILD_AVATAR_MAX_BYTES} bytes`,
      });
    }
    if (!matchesSignature(mime, data)) {
      throw invalidAvatar('File signature does not match mime');
    }

    await this.requireChild(familyId, childId);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const avatarKey = `photo:${sha256.slice(0, 12)}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.childAvatarPhoto.upsert({
        where: { childId },
        create: { childId, mime, sha256, data },
        update: { mime, sha256, data },
      });
      await tx.child.update({ where: { id: childId }, data: { avatarKey } });
    });
    return { avatarKey };
  }

  /// «Убрать» аватар: `avatarKey = null`, фото удаляется.
  async removeAvatar(familyId: string, childId: string): Promise<void> {
    await this.requireChild(familyId, childId);
    await this.prisma.$transaction(async (tx) => {
      await tx.childAvatarPhoto.deleteMany({ where: { childId } });
      await tx.child.update({ where: { id: childId }, data: { avatarKey: null } });
    });
  }

  /// Байты фото ребёнка — только для семьи ребёнка и не удалённого ребёнка (ПДн).
  async getAvatarPhoto(familyId: string, childId: string): Promise<ChildAvatarPhotoBytes> {
    await this.requireChild(familyId, childId);
    const photo = await this.prisma.childAvatarPhoto.findUnique({
      where: { childId },
      select: { mime: true, sha256: true, data: true },
    });
    if (!photo) {
      throw new NotFoundException({ code: 'avatar_not_found', message: 'Avatar photo not found' });
    }
    return { mime: photo.mime, sha256: photo.sha256, data: Buffer.from(photo.data) };
  }

  private async requireChild(familyId: string, childId: string): Promise<void> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null },
      select: { id: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
  }

  async getProtection(familyId: string, childId: string): Promise<ProtectionState> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null },
      select: { protectionEnabled: true, protectionEnabledAt: true, protectionEnabledBy: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    return {
      enabled: child.protectionEnabled,
      enabledAt: child.protectionEnabledAt,
      enabledBy: child.protectionEnabledBy,
    };
  }

  async setProtection(
    familyId: string,
    childId: string,
    enabled: boolean,
    userId: string,
  ): Promise<ProtectionState> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null },
      select: { id: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }

    const now = enabled ? new Date() : null;
    const updated = await this.prisma.child.update({
      where: { id: childId },
      data: {
        protectionEnabled: enabled,
        protectionEnabledAt: now,
        protectionEnabledBy: enabled ? userId : null,
      },
      select: { protectionEnabled: true, protectionEnabledAt: true, protectionEnabledBy: true },
    });
    return {
      enabled: updated.protectionEnabled,
      enabledAt: updated.protectionEnabledAt,
      enabledBy: updated.protectionEnabledBy,
    };
  }

  async softDelete(familyId: string, childId: string): Promise<void> {
    const existing = await this.getChildInFamily(familyId, childId);
    if (!existing) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.child.update({ where: { id: childId }, data: { deletedAt: now } }),
      this.prisma.childDevice.updateMany({
        where: { childId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.invite.updateMany({
        where: { childId, consumedAt: null },
        data: { consumedAt: now },
      }),
    ]);
  }

  /// Отвязать устройство ребёнка, НЕ удаляя самого ребёнка: отзываем активный
  /// device-token и гасим неиспользованные invites. Ребёнок остаётся в списке
  /// (без устройства), позже его можно привязать заново по новому QR-коду.
  /// Тот же revoke-механизм, что и в [softDelete], но без `deletedAt`.
  /// Возвращает `true`, если было что отвязывать (активное устройство).
  async unbindDevice(familyId: string, childId: string): Promise<{ unbound: boolean }> {
    const existing = await this.getChildInFamily(familyId, childId);
    if (!existing) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    const now = new Date();
    const [devices] = await this.prisma.$transaction([
      this.prisma.childDevice.updateMany({
        where: { childId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.invite.updateMany({
        where: { childId, consumedAt: null },
        data: { consumedAt: now },
      }),
    ]);
    return { unbound: devices.count > 0 };
  }
}
