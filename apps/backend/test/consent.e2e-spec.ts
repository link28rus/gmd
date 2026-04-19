import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { CONSENT_CONFIG } from '../src/consent/consent.module';

describe('Consent flow (e2e)', () => {
  let h: TestAppHandle;

  beforeAll(async () => {
    process.env.PRIVACY_POLICY_VERSION = '1.0';
    h = await bootTestApp();
  }, 180_000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await truncateAll(h);
  });

  async function registerAndLogin(email: string): Promise<string> {
    const server = h.app.getHttpServer();
    await request(server).post('/auth/request-otp').send({ email }).expect(202);
    const otp = h.delivery.lastCodeFor(email);
    if (!otp) throw new Error('no otp');
    const v = await request(server).post('/auth/verify-otp').send({ email, code: otp }).expect(200);
    return v.body.accessToken as string;
  }

  it('новый юзер после login — requiresConsent=false (version совпадает)', async () => {
    const token = await registerAndLogin('user1@example.com');
    const me = await request(h.app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.requiresConsent).toBe(false);
    expect(me.body.currentPolicyVersion).toBe('1.0');
  });

  it('после bump версии до 2.0 — requiresConsent=true', async () => {
    const token = await registerAndLogin('user2@example.com');

    // Override CONSENT_CONFIG version to 2.0 in the running app
    const consentCfg = h.app.get(CONSENT_CONFIG);
    consentCfg.privacyPolicyVersion = '2.0';

    const me = await request(h.app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.requiresConsent).toBe(true);
    expect(me.body.currentPolicyVersion).toBe('2.0');

    // Restore
    consentCfg.privacyPolicyVersion = '1.0';
  });

  it('мутация POST /family/children → 403 consent_required когда requiresConsent=true', async () => {
    const token = await registerAndLogin('user3@example.com');

    const consentCfg = h.app.get(CONSENT_CONFIG);
    consentCfg.privacyPolicyVersion = '2.0';

    const r = await request(h.app.getHttpServer())
      .post('/family/children')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Kid' })
      .expect(403);
    expect(r.body.error.code).toBe('consent_required');

    consentCfg.privacyPolicyVersion = '1.0';
  });

  it('полный flow: consent_required → POST /me/consent → мутация работает', async () => {
    const server = h.app.getHttpServer();
    const token = await registerAndLogin('user4@example.com');

    const consentCfg = h.app.get(CONSENT_CONFIG);
    consentCfg.privacyPolicyVersion = '2.0';

    // 403 on mutation
    await request(server)
      .post('/family/children')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Kid' })
      .expect(403);

    // POST /me/consent → 204
    await request(server)
      .post('/me/consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ documents: ['PRIVACY_POLICY', 'TERMS_OF_USE'] })
      .expect(204);

    // GET /me → requiresConsent=false
    const me = await request(server).get('/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.requiresConsent).toBe(false);

    // Mutation now works
    await request(server)
      .post('/family/children')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Kid' })
      .expect(201);

    consentCfg.privacyPolicyVersion = '1.0';
  });

  it('POST /me/consent повторно → 400 consent_already_accepted', async () => {
    const server = h.app.getHttpServer();
    const token = await registerAndLogin('user5@example.com');

    // First consent (version already 1.0, matches)
    await request(server)
      .post('/me/consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ documents: ['PRIVACY_POLICY'] })
      .expect(400)
      .then((r) => expect(r.body.error.code).toBe('consent_already_accepted'));
  });

  it('ConsentRecord создаётся в БД после POST /me/consent', async () => {
    const server = h.app.getHttpServer();
    const token = await registerAndLogin('user6@example.com');

    const consentCfg = h.app.get(CONSENT_CONFIG);
    consentCfg.privacyPolicyVersion = '2.0';

    await request(server)
      .post('/me/consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ documents: ['PRIVACY_POLICY', 'TERMS_OF_USE'] })
      .expect(204);

    const records = await h.prisma.consentRecord.findMany({
      where: { subjectType: 'USER' },
    });
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.documentType).sort()).toEqual(['PRIVACY_POLICY', 'TERMS_OF_USE']);

    consentCfg.privacyPolicyVersion = '1.0';
  });
});
