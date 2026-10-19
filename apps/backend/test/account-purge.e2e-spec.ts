import request from 'supertest';
import { bootTestApp, registerVerifiedUser, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { AccountPurgeService } from '../src/users/account-purge.service';

/** 152-ФЗ: удалённое старше 30 дней стирается насовсем. */
describe('Окончательное удаление через 30 дней (e2e)', () => {
  let h: TestAppHandle;
  let purge: AccountPurgeService;

  beforeAll(async () => {
    h = await bootTestApp();
    purge = h.app.get(AccountPurgeService);
  }, 180_000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await truncateAll(h);
  });

  const server = () => h.app.getHttpServer();
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

  async function addChild(token: string, name = 'Ваня'): Promise<string> {
    const r = await request(server())
      .post('/family/children')
      .set(bearer(token))
      .send({ name })
      .expect(201);
    return r.body.child.id as string;
  }

  function zoneData(familyId: string, createdBy: string) {
    return {
      familyId,
      createdBy,
      name: 'Школа',
      color: '#2563eb',
      icon: 'school',
      centerLat: 55.75,
      centerLon: 37.62,
      radius: 150,
    };
  }

  /** Владелец + второй взрослый в его семье. */
  async function familyOfTwo() {
    const owner = await registerVerifiedUser(h, 'owner@x.com');
    const second = await registerVerifiedUser(h, 'second@x.com');
    const inv = await request(server())
      .post('/family/member-invites')
      .set(bearer(owner.accessToken))
      .expect(201);
    await request(server())
      .post('/family/member-invites/accept')
      .set(bearer(second.accessToken))
      .send({ code: inv.body.invite.code })
      .expect(200);
    return { owner, second };
  }

  it('DELETE /me одиночки: через 29 дней всё на месте, через 31 — стёрто вместе с семьёй', async () => {
    const u = await registerVerifiedUser(h, 'solo@x.com');
    const childId = await addChild(u.accessToken);
    await h.prisma.zone.create({ data: zoneData(u.familyId, u.userId) });
    await request(server()).delete('/me').set(bearer(u.accessToken)).expect(204);

    const deletedAt = (await h.prisma.user.findUniqueOrThrow({ where: { id: u.userId } }))
      .deletedAt!;
    const at = (days: number) => new Date(deletedAt.getTime() + days * 24 * 60 * 60 * 1000);

    expect(await purge.purgeExpired(at(29))).toEqual({
      families: 0,
      children: 0,
      users: 0,
    });
    expect(await h.prisma.user.count()).toBe(1);

    const r = await purge.purgeExpired(at(31));
    expect(r).toMatchObject({ families: 1, users: 1 });
    expect(await h.prisma.user.count()).toBe(0);
    expect(await h.prisma.family.count()).toBe(0);
    expect(await h.prisma.child.count({ where: { id: childId } })).toBe(0);
    expect(await h.prisma.zone.count()).toBe(0);
    expect(await h.prisma.consentRecord.count()).toBe(0);

    // Почта свободна — тот же адрес можно зарегистрировать заново.
    await registerVerifiedUser(h, 'solo@x.com');
  });

  it('ушёл второй взрослый: его зона переходит владельцу, сессия «Звука» стирается', async () => {
    const { owner, second } = await familyOfTwo();
    const childId = await addChild(owner.accessToken);
    const zone = await h.prisma.zone.create({ data: zoneData(owner.familyId, second.userId) });
    const device = await h.prisma.childDevice.create({
      data: { childId, tokenHash: 'hash-1' },
    });
    await h.prisma.audioSession.create({
      data: {
        childId,
        childDeviceId: device.id,
        requestedById: second.userId,
        durationSec: 60,
      },
    });

    await h.prisma.membership.deleteMany({ where: { userId: second.userId } });
    await h.prisma.user.update({ where: { id: second.userId }, data: { deletedAt: daysAgo(31) } });

    expect(await purge.purgeExpired()).toMatchObject({ users: 1, families: 0 });
    expect(await h.prisma.user.count({ where: { id: second.userId } })).toBe(0);
    expect((await h.prisma.zone.findUniqueOrThrow({ where: { id: zone.id } })).createdBy).toBe(
      owner.userId,
    );
    expect(await h.prisma.audioSession.count()).toBe(0);
    expect(await h.prisma.child.count({ where: { id: childId } })).toBe(1);
  });

  it('семью удалил админ при живых взрослых: им выдаётся новая пустая семья', async () => {
    const { owner, second } = await familyOfTwo();
    await addChild(owner.accessToken);
    await h.prisma.family.update({
      where: { id: owner.familyId },
      data: { deletedAt: daysAgo(31) },
    });
    await h.prisma.child.updateMany({
      where: { familyId: owner.familyId },
      data: { deletedAt: daysAgo(31) },
    });

    expect(await purge.purgeExpired()).toMatchObject({ families: 1, users: 0 });
    expect(await h.prisma.family.count({ where: { id: owner.familyId } })).toBe(0);
    for (const userId of [owner.userId, second.userId]) {
      const m = await h.prisma.membership.findMany({ where: { userId } });
      expect(m).toHaveLength(1);
      expect(m[0]!.role).toBe('owner');
    }
  });

  it('ребёнок, удалённый 31 день назад, стирается; семья и свежеудалённый — остаются', async () => {
    const u = await registerVerifiedUser(h, 'p@x.com');
    const oldChild = await addChild(u.accessToken, 'Старый');
    const freshChild = await addChild(u.accessToken, 'Свежий');
    await h.prisma.child.update({ where: { id: oldChild }, data: { deletedAt: daysAgo(31) } });
    await h.prisma.child.update({ where: { id: freshChild }, data: { deletedAt: daysAgo(3) } });

    expect(await purge.purgeExpired()).toMatchObject({ children: 1 });
    expect(await h.prisma.child.count({ where: { id: oldChild } })).toBe(0);
    expect(await h.prisma.child.count({ where: { id: freshChild } })).toBe(1);
    expect(await h.prisma.family.count({ where: { id: u.familyId } })).toBe(1);
  });
});
