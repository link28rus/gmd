import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { signUpParent } from './fixtures/seed';

/** v0.75.0: ФИО в профиле кабинета — PATCH /me { lastName, firstName, middleName }. */
describe('Profile name (e2e, v0.75.0)', () => {
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

  it('ФИО сохраняется, собирается в name и видно в /me и у владельца в «Найти телефон»', async () => {
    const mom = await signUpParent(h);
    const auth = { Authorization: `Bearer ${mom.accessToken}` };

    await request(server()).patch('/me').send({ lastName: 'А', firstName: 'Б' }).expect(401);
    // Фамилия и имя — только вместе; запрещённые символы — 400
    await request(server()).patch('/me').set(auth).send({ lastName: 'Четверик' }).expect(400);
    await request(server()).patch('/me').set(auth).send({ middleName: 'Ивановна' }).expect(400);
    await request(server())
      .patch('/me')
      .set(auth)
      .send({ lastName: '<b>', firstName: 'Нина' })
      .expect(400);
    await request(server())
      .patch('/me')
      .set(auth)
      .send({ lastName: 'x'.repeat(81), firstName: 'Нина' })
      .expect(400);

    const r = await request(server())
      .patch('/me')
      .set(auth)
      .send({ lastName: ' Четверик ', firstName: 'Нина', middleName: 'Александровна' })
      .expect(200);
    expect(r.body.user).toMatchObject({
      name: 'Четверик Нина Александровна',
      lastName: 'Четверик',
      firstName: 'Нина',
      middleName: 'Александровна',
    });

    const me = await request(server()).get('/me').set(auth).expect(200);
    expect(me.body.user).toMatchObject({
      name: 'Четверик Нина Александровна',
      lastName: 'Четверик',
      middleName: 'Александровна',
    });

    // Пустое отчество — убирается
    const noMiddle = await request(server())
      .patch('/me')
      .set(auth)
      .send({ lastName: 'Четверик', firstName: 'Нина', middleName: '' })
      .expect(200);
    expect(noMiddle.body.user).toMatchObject({ name: 'Четверик Нина', middleName: null });

    // Имя владельца телефона в «Найти телефон» берётся из ФИО
    await request(server()).post('/parent-location/devices').set(auth).send({}).expect(201);
    const phones = await request(server()).get('/parent-location/my-devices').set(auth).expect(200);
    expect(phones.body.items[0].ownerName).toBe('Четверик Нина');
  });
});
