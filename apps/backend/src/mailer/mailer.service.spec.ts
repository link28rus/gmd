import { Test } from '@nestjs/testing';
import { MailerService, SMTP_CONFIG, type SmtpConfig } from './mailer.service';

const createTransportMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: (opts: unknown) => createTransportMock(opts),
}));

describe('MailerService', () => {
  let svc: MailerService;
  const sendMail = jest.fn();

  beforeEach(() => {
    createTransportMock.mockReset().mockReturnValue({ sendMail });
    sendMail.mockReset().mockResolvedValue(undefined);
  });

  async function build(cfg: SmtpConfig): Promise<MailerService> {
    const mod = await Test.createTestingModule({
      providers: [MailerService, { provide: SMTP_CONFIG, useValue: cfg }],
    }).compile();
    return mod.get(MailerService);
  }

  it('skips send when host is localhost', async () => {
    svc = await build({ host: 'localhost', port: 1025, from: 'no-reply@x' });
    await svc.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends when host is configured', async () => {
    svc = await build({ host: 'smtp.yandex.ru', port: 465, user: 'u', pass: 'p', from: 'from@x' });
    await svc.send({ to: 'a@b.c', subject: 's', text: 't', html: '<b>h</b>' });
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
});
