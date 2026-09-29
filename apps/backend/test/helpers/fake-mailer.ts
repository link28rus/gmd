import type { MailPayload } from '../../src/mailer/mailer.service';

/**
 * Подмена MailerService в e2e: письма (подтверждение email, сброс пароля)
 * не уходят в SMTP, а складываются в память — тест достаёт из них ссылку.
 */
export class FakeMailer {
  public readonly sent: MailPayload[] = [];

  send(payload: MailPayload): Promise<void> {
    this.sent.push(payload);
    return Promise.resolve();
  }

  sendTest(to: string): Promise<{ ok: true; messageId: string }> {
    this.sent.push({ to, subject: 'test', text: 'test' });
    return Promise.resolve({ ok: true, messageId: 'fake' });
  }

  invalidate(): void {}

  /** Токен из последней ссылки `...?token=<hex>`, отправленной на `to`. */
  lastTokenFor(to: string): string | undefined {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    return mail?.text.match(/[?&]token=([0-9a-f]+)/)?.[1];
  }

  reset(): void {
    this.sent.length = 0;
  }
}
