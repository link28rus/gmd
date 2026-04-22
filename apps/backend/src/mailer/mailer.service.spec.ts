import { Test } from '@nestjs/testing';
import { MailerService } from './mailer.service';
import { AppSettingsService, SETTINGS_KEYS } from '../app-settings/app-settings.service';

const createTransportMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: (opts: unknown) => createTransportMock(opts),
}));

interface SmtpFake {
  host: string;
  port: string;
  user: string;
  pass: string;
  from: string;
}

function fakeSettings(cfg: SmtpFake): AppSettingsService {
  return {
    getString: jest.fn((key: string, _fallback: string) => {
      switch (key) {
        case SETTINGS_KEYS.SMTP_HOST:
          return Promise.resolve(cfg.host);
        case SETTINGS_KEYS.SMTP_PORT:
          return Promise.resolve(cfg.port);
        case SETTINGS_KEYS.SMTP_USER:
          return Promise.resolve(cfg.user);
        case SETTINGS_KEYS.SMTP_PASS:
          return Promise.resolve(cfg.pass);
        case SETTINGS_KEYS.SMTP_FROM:
          return Promise.resolve(cfg.from);
        default:
          return Promise.resolve(_fallback);
      }
    }),
  } as unknown as AppSettingsService;
}

describe('MailerService', () => {
  const sendMail = jest.fn();

  beforeEach(() => {
    createTransportMock.mockReset().mockReturnValue({ sendMail });
    sendMail.mockReset().mockResolvedValue({ messageId: 'mid-123' });
  });

  async function build(cfg: SmtpFake): Promise<MailerService> {
    const mod = await Test.createTestingModule({
      providers: [MailerService, { provide: AppSettingsService, useValue: fakeSettings(cfg) }],
    }).compile();
    return mod.get(MailerService);
  }

  it('skips send when host is localhost', async () => {
    const svc = await build({
      host: 'localhost',
      port: '1025',
      user: '',
      pass: '',
      from: 'no-reply@x',
    });
    await svc.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends when host is configured, secure flag = port 465', async () => {
    const svc = await build({
      host: 'smtp.yandex.ru',
      port: '465',
      user: 'u',
      pass: 'p',
      from: 'from@x',
    });
    await svc.send({ to: 'a@b.c', subject: 's', text: 't', html: '<b>h</b>' });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.yandex.ru', port: 465, secure: true }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'from@x',
        to: 'a@b.c',
        subject: 's',
        text: 't',
        html: '<b>h</b>',
      }),
    );
  });

  it('sendTest возвращает { ok: true, messageId } при успехе', async () => {
    const svc = await build({
      host: 'smtp.yandex.ru',
      port: '465',
      user: 'u',
      pass: 'p',
      from: 'from@x',
    });
    const r = await svc.sendTest('a@b.c');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messageId).toBe('mid-123');
  });

  it('sendTest возвращает { ok: false, error } при падении', async () => {
    sendMail.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));
    const svc = await build({
      host: 'smtp.yandex.ru',
      port: '465',
      user: 'u',
      pass: 'p',
      from: 'from@x',
    });
    const r = await svc.sendTest('a@b.c');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ETIMEDOUT/);
  });

  it('invalidate() заставляет loadConfig перечитывать настройки', async () => {
    const settings = fakeSettings({
      host: 'a',
      port: '465',
      user: '',
      pass: '',
      from: 'f',
    });
    const mod = await Test.createTestingModule({
      providers: [MailerService, { provide: AppSettingsService, useValue: settings }],
    }).compile();
    const svc = mod.get(MailerService);
    await svc.send({ to: 'x@y.z', subject: 's', text: 't' });
    await svc.send({ to: 'x@y.z', subject: 's', text: 't' });
    // Второй send внутри TTL — без повторной перечитки
    expect(settings.getString).toHaveBeenCalledTimes(5);
    svc.invalidate();
    await svc.send({ to: 'x@y.z', subject: 's', text: 't' });
    expect(settings.getString).toHaveBeenCalledTimes(10);
  });
});
