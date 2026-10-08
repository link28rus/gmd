import request from 'supertest';
import { bootTestApp, registerVerifiedUser, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';

/** v0.71.0: docs/superpowers/specs/2026-10-08-family-members.md */
describe('Участники семьи (e2e, v0.71.0)', () => {
  let h: TestAppHandle;

  beforeAll(async () => {
    h = await bootTestApp();
  }, 180_000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await truncateAll(h);
  });

  const server = () => h.app.getHttpServer();
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const jwtClaims = (t: string) =>
    JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString()) as {
      familyId: string;
      role: string;
    };

  async function refresh(refreshToken: string) {
    const r = await request(server()).post('/auth/refresh').send({ refreshToken }).expect(200);
    return {
      accessToken: r.body.accessToken as string,
      refreshToken: r.body.refreshToken as string,
    };
  }

  async function invite(ownerToken: string) {
    const r = await request(server())
      .post('/family/member-invites')
      .set(bearer(ownerToken))
      .expect(201);
    return r.body.invite as { id: string; code: string; url: string; expiresAt: string };
  }

  /** Владелец + второй взрослый, вступивший по приглашению (токены уже после refresh). */
  async function familyOfTwo() {
    const owner = await registerVerifiedUser(h, 'owner@x.com');
    const second = await registerVerifiedUser(h, 'second@x.com');
    const inv = await invite(owner.accessToken);
    await request(server())
      .post('/family/member-invites/accept')
      .set(bearer(second.accessToken))
      .send({ code: inv.code })
      .expect(200);
    const fresh = await refresh(second.refreshToken);
    return { owner, second: { ...second, ...fresh }, oldSecondFamilyId: second.familyId };
  }

  it('приглашение → превью → принятие: пустая семья растворяется, токен устаревает', async () => {
    const owner = await registerVerifiedUser(h, 'owner@x.com');
    const second = await registerVerifiedUser(h, 'second@x.com');

    const inv = await invite(owner.accessToken);
    expect(inv.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(inv.url).toMatch(new RegExp(`/join/${inv.code}$`));

    const pv = await request(server())
      .get('/family/member-invites/preview')
      .query({ code: `${inv.code.slice(0, 4)}-${inv.code.slice(4).toLowerCase()}` })
      .set(bearer(second.accessToken))
      .expect(200);
    expect(pv.body).toMatchObject({ family: { name: 'Родитель' }, canJoin: true });
    expect(pv.body.invitedBy).toBe('Родитель Тест');

    const acc = await request(server())
      .post('/family/member-invites/accept')
      .set(bearer(second.accessToken))
      .send({ code: inv.code })
      .expect(200);
    expect(acc.body).toEqual({ family: { id: owner.familyId, name: 'Родитель' }, role: 'parent' });

    // Прежняя пустая семья — в soft-delete, членство одно.
    const old = await h.prisma.family.findUniqueOrThrow({ where: { id: second.familyId } });
    expect(old.deletedAt).not.toBeNull();
    const ms = await h.prisma.membership.findMany({ where: { userId: second.userId } });
    expect(ms).toEqual([expect.objectContaining({ familyId: owner.familyId, role: 'parent' })]);

    // Старый токен (familyId прежней семьи) больше не принимается.
    const stale = await request(server()).get('/family/members').set(bearer(second.accessToken));
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe('token_stale');

    // refresh → токен новой семьи с реальной ролью.
    const fresh = await refresh(second.refreshToken);
    expect(jwtClaims(fresh.accessToken)).toMatchObject({
      familyId: owner.familyId,
      role: 'parent',
    });
    const list = await request(server())
      .get('/family/members')
      .set(bearer(fresh.accessToken))
      .expect(200);
    expect(list.body.myRole).toBe('parent');
    expect(
      list.body.members.map((m: { email: string; role: string; isMe: boolean }) => [
        m.email,
        m.role,
        m.isMe,
      ]),
    ).toEqual([
      ['owner@x.com', 'owner', false],
      ['second@x.com', 'parent', true],
    ]);

    // Код одноразовый.
    const third = await registerVerifiedUser(h, 'third@x.com');
    const reuse = await request(server())
      .post('/family/member-invites/accept')
      .set(bearer(third.accessToken))
      .send({ code: inv.code })
      .expect(404);
    expect(reuse.body.error.code).toBe('invite_invalid');
  });

  it('логин вступившего — JWT с ролью parent и семьёй владельца', async () => {
    const { owner } = await familyOfTwo();
    await request(server()).post('/auth/request-otp').send({ email: 'second@x.com' }).expect(200);
    const v = await request(server())
      .post('/auth/verify-otp')
      .send({ email: 'second@x.com', code: h.delivery.lastCodeFor('second@x.com')! })
      .expect(200);
    expect(v.body.family.id).toBe(owner.familyId);
    expect(jwtClaims(v.body.accessToken)).toMatchObject({
      familyId: owner.familyId,
      role: 'parent',
    });
  });

  it('новый участник видит детей семьи', async () => {
    const { owner, second } = await familyOfTwo();
    await request(server())
      .post('/family/children')
      .set(bearer(owner.accessToken))
      .send({ name: 'Ваня' })
      .expect(201);
    const list = await request(server())
      .get('/family/children')
      .set(bearer(second.accessToken))
      .expect(200);
    expect(list.body.children.map((c: { name: string }) => c.name)).toEqual(['Ваня']);
  });

  it('нельзя перейти, если в своей семье есть дети или другие взрослые', async () => {
    const owner = await registerVerifiedUser(h, 'owner@x.com');
    const withKid = await registerVerifiedUser(h, 'kid@x.com');
    await request(server())
      .post('/family/children')
      .set(bearer(withKid.accessToken))
      .send({ name: 'Петя' })
      .expect(201);
    const inv = await invite(owner.accessToken);

    const pv = await request(server())
      .get('/family/member-invites/preview')
      .query({ code: inv.code })
      .set(bearer(withKid.accessToken))
      .expect(200);
    expect(pv.body).toMatchObject({ canJoin: false, reason: 'has_children', children: 1 });

    const r = await request(server())
      .post('/family/member-invites/accept')
      .set(bearer(withKid.accessToken))
      .send({ code: inv.code })
      .expect(409);
    expect(r.body.error).toMatchObject({
      code: 'current_family_not_empty',
      reason: 'has_children',
    });

    // Владелец семьи из двух взрослых тоже не может уйти по чужому приглашению.
    const other = await registerVerifiedUser(h, 'other@x.com');
    const inv2 = await invite(other.accessToken);
    const r2 = await request(server())
      .post('/family/member-invites/accept')
      .set(bearer(owner.accessToken))
      .send({ code: inv2.code })
      .expect(200); // у owner пока пустая семья — можно
    expect(r2.body.role).toBe('parent');

    // Уже участник этой семьи.
    const fresh = await refresh(owner.refreshToken);
    const inv3 = await invite(other.accessToken);
    const r3 = await request(server())
      .post('/family/member-invites/accept')
      .set(bearer(fresh.accessToken))
      .send({ code: inv3.code })
      .expect(409);
    expect(r3.body.error.code).toBe('already_member');

    // У other теперь есть второй взрослый → его владелец не может перейти.
    const third = await registerVerifiedUser(h, 'third@x.com');
    const inv4 = await invite(third.accessToken);
    const r4 = await request(server())
      .post('/family/member-invites/accept')
      .set(bearer(other.accessToken))
      .send({ code: inv4.code })
      .expect(409);
    expect(r4.body.error).toMatchObject({ reason: 'has_members', members: 1 });
  });

  it('права владельца: участник не приглашает, не удаляет, не передаёт', async () => {
    const { owner, second } = await familyOfTwo();
    await request(server())
      .post('/family/member-invites')
      .set(bearer(second.accessToken))
      .expect(403);
    await request(server())
      .get('/family/member-invites')
      .set(bearer(second.accessToken))
      .expect(403);
    await request(server())
      .delete(`/family/members/${owner.userId}`)
      .set(bearer(second.accessToken))
      .expect(403);
    await request(server())
      .post('/family/transfer-ownership')
      .set(bearer(second.accessToken))
      .send({ userId: owner.userId })
      .expect(403);
    await request(server())
      .delete(`/family/members/${owner.userId}`)
      .set(bearer(owner.accessToken))
      .expect(400);
  });

  it('приглашения: список активных и отзыв', async () => {
    const owner = await registerVerifiedUser(h, 'owner@x.com');
    const a = await invite(owner.accessToken);
    const b = await invite(owner.accessToken);
    await request(server())
      .delete(`/family/member-invites/${a.id}`)
      .set(bearer(owner.accessToken))
      .expect(204);
    const list = await request(server())
      .get('/family/member-invites')
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(list.body.invites.map((i: { id: string }) => i.id)).toEqual([b.id]);

    const guest = await registerVerifiedUser(h, 'guest@x.com');
    await request(server())
      .post('/family/member-invites/accept')
      .set(bearer(guest.accessToken))
      .send({ code: a.code })
      .expect(404);
    await request(server())
      .get('/family/member-invites/preview')
      .query({ code: 'garbage' })
      .set(bearer(guest.accessToken))
      .expect(404);
  });

  it('удаление участника: доступ пропадает сразу, у него новая пустая семья', async () => {
    const { owner, second } = await familyOfTwo();
    await request(server())
      .delete(`/family/members/${second.userId}`)
      .set(bearer(owner.accessToken))
      .expect(204);

    const r = await request(server()).get('/family/children').set(bearer(second.accessToken));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('token_stale');

    const fresh = await refresh(second.refreshToken);
    const claims = jwtClaims(fresh.accessToken);
    expect(claims.familyId).not.toBe(owner.familyId);
    expect(claims.role).toBe('owner');
    const list = await request(server())
      .get('/family/members')
      .set(bearer(fresh.accessToken))
      .expect(200);
    expect(list.body.members).toHaveLength(1);
    expect(list.body.family.name).toBe('Родитель');
  });

  it('выход: участник уходит, владелец — только после передачи прав', async () => {
    const { owner, second } = await familyOfTwo();
    const r = await request(server())
      .post('/family/leave')
      .set(bearer(owner.accessToken))
      .expect(409);
    expect(r.body.error.code).toBe('owner_must_transfer');

    await request(server())
      .post('/family/transfer-ownership')
      .set(bearer(owner.accessToken))
      .send({ userId: second.userId })
      .expect(204);
    const roles = await h.prisma.membership.findMany({
      where: { familyId: owner.familyId },
      select: { userId: true, role: true },
    });
    expect(Object.fromEntries(roles.map((m) => [m.userId, m.role]))).toEqual({
      [owner.userId]: 'parent',
      [second.userId]: 'owner',
    });

    // Старый токен бывшего владельца устарел; после refresh — роль parent, можно выйти.
    await request(server()).post('/family/leave').set(bearer(owner.accessToken)).expect(401);
    const fresh = await refresh(owner.refreshToken);
    expect(jwtClaims(fresh.accessToken).role).toBe('parent');
    const left = await request(server())
      .post('/family/leave')
      .set(bearer(fresh.accessToken))
      .expect(200);
    expect(left.body.family.id).not.toBe(owner.familyId);
    const remaining = await h.prisma.membership.count({ where: { familyId: owner.familyId } });
    expect(remaining).toBe(1);
  });

  it('v0.72.0: владелец заводит участника по email и паролю — вход сразу, политику принимает сам', async () => {
    const owner = await registerVerifiedUser(h, 'owner@x.com');
    const r = await request(server())
      .post('/family/members')
      .set(bearer(owner.accessToken))
      .send({
        email: ' Granny@X.com ',
        lastName: 'Петрова',
        firstName: 'Галина',
        middleName: 'Ивановна',
        password: 'granny-pass-1',
      })
      .expect(201);
    expect(r.body.member).toMatchObject({
      email: 'granny@x.com',
      displayName: 'Петрова Галина Ивановна',
      role: 'parent',
      isMe: false,
    });

    // Вход паролем без подтверждения email.
    const login = await request(server())
      .post('/auth/login-password')
      .send({ email: 'granny@x.com', password: 'granny-pass-1' })
      .expect(200);
    expect(login.body.family.id).toBe(owner.familyId);
    expect(jwtClaims(login.body.accessToken)).toMatchObject({ role: 'parent' });
    const auth = bearer(login.body.accessToken);

    // Данные семьи видны, но политику участник ещё не принимал.
    await request(server()).get('/family/children').set(auth).expect(200);
    const me = await request(server()).get('/me').set(auth).expect(200);
    expect(me.body.requiresConsent).toBe(true);
    const blocked = await request(server())
      .post('/family/children')
      .set(auth)
      .send({ name: 'Ваня' })
      .expect(403);
    expect(blocked.body.error.code).toBe('consent_required');

    await request(server())
      .post('/me/consent')
      .set(auth)
      .send({ documents: ['PRIVACY_POLICY', 'TERMS_OF_USE'] })
      .expect(204);
    await request(server()).post('/family/children').set(auth).send({ name: 'Ваня' }).expect(201);

    // Повтор email (в т.ч. чужой зарегистрированный) → 409, участник — 403.
    const dup = await request(server())
      .post('/family/members')
      .set(bearer(owner.accessToken))
      .send({
        email: 'owner@x.com',
        lastName: 'Иванов',
        firstName: 'Кто-то',
        password: 'whatever-1',
      })
      .expect(409);
    expect(dup.body.error.code).toBe('email_taken');
    await request(server())
      .post('/family/members')
      .set(auth)
      .send({ email: 'new@x.com', lastName: 'Новиков', firstName: 'Новый', password: 'whatever-1' })
      .expect(403);
    await request(server())
      .post('/family/members')
      .set(bearer(owner.accessToken))
      .send({ email: 'short@x.com', lastName: 'Коротков', firstName: 'Коротко', password: '123' })
      .expect(400);
    // Без фамилии — 400.
    await request(server())
      .post('/family/members')
      .set(bearer(owner.accessToken))
      .send({ email: 'nolast@x.com', firstName: 'Безфамильный', password: 'whatever-1' })
      .expect(400);
  });

  it('v0.72.1: удалённый или неподтверждённый email занимается заново', async () => {
    const owner = await registerVerifiedUser(h, 'owner@x.com');
    const create = (email: string) =>
      request(server())
        .post('/family/members')
        .set(bearer(owner.accessToken))
        .send({ email, lastName: 'Новая', firstName: 'Нина', password: 'nina-pass-12' });

    // 1) Удалил аккаунт сам (DELETE /me): строка осталась с deletedAt.
    const gone = await registerVerifiedUser(h, 'gone@x.com');
    await request(server()).delete('/me').set(bearer(gone.accessToken)).expect(204);
    const r1 = await create('gone@x.com').expect(201);
    expect(r1.body.member.userId).toBe(gone.userId); // запись переиспользована
    const u1 = await h.prisma.user.findUniqueOrThrow({ where: { id: gone.userId } });
    expect(u1).toMatchObject({
      deletedAt: null,
      firstName: 'Нина',
      acceptedPrivacyPolicyVersion: null,
      role: 'parent',
    });
    expect(u1.emailVerifiedAt).not.toBeNull();
    const ms1 = await h.prisma.membership.findMany({ where: { userId: gone.userId } });
    expect(ms1).toEqual([expect.objectContaining({ familyId: owner.familyId, role: 'parent' })]);
    // Старая сессия не воскресла, новый пароль работает.
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: gone.refreshToken })
      .expect(401);
    await request(server())
      .post('/auth/login-password')
      .send({ email: 'gone@x.com', password: 'nina-pass-12' })
      .expect(200);

    // 2) Начал регистрацию и не подтвердил: его пустая семья растворяется.
    await request(server())
      .post('/auth/register')
      .send({
        email: 'pending@x.com',
        password: 'pending-pass-1',
        passwordConfirm: 'pending-pass-1',
        firstName: 'Ждун',
        lastName: 'Ждунов',
      })
      .expect(202);
    const pending = await h.prisma.user.findUniqueOrThrow({
      where: { email: 'pending@x.com' },
      include: { memberships: true },
    });
    const pendingFamily = pending.memberships[0]!.familyId;
    const r2 = await create('pending@x.com').expect(201);
    expect(r2.body.member.userId).toBe(pending.id);
    const ms2 = await h.prisma.membership.findMany({ where: { userId: pending.id } });
    expect(ms2).toEqual([expect.objectContaining({ familyId: owner.familyId })]);
    const oldFam = await h.prisma.family.findUniqueOrThrow({ where: { id: pendingFamily } });
    expect(oldFam.deletedAt).not.toBeNull();
    // Ссылка подтверждения из старого письма больше не действует.
    expect(await h.prisma.emailVerificationToken.count({ where: { userId: pending.id } })).toBe(0);

    // 3) Живой подтверждённый — по-прежнему 409.
    await registerVerifiedUser(h, 'alive@x.com');
    const r3 = await create('alive@x.com').expect(409);
    expect(r3.body.error.code).toBe('email_taken');
  });

  it('DELETE /me владельца: права переходят второму взрослому', async () => {
    const { owner, second } = await familyOfTwo();
    await request(server())
      .delete('/me')
      .set(bearer(owner.accessToken))
      .expect((res) => {
        expect([200, 204]).toContain(res.status);
      });
    const ms = await h.prisma.membership.findMany({ where: { familyId: owner.familyId } });
    expect(ms).toEqual([expect.objectContaining({ userId: second.userId, role: 'owner' })]);
    const fam = await h.prisma.family.findUniqueOrThrow({ where: { id: owner.familyId } });
    expect(fam.deletedAt).toBeNull();
  });
});
