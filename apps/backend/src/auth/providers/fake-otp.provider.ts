import { Injectable } from '@nestjs/common';
import type { OtpDeliveryProvider } from './otp-delivery.provider';

@Injectable()
export class FakeOtpProvider implements OtpDeliveryProvider {
  public readonly sent: Array<{ to: string; code: string; at: Date }> = [];

  send(to: string, code: string): Promise<void> {
    this.sent.push({ to, code, at: new Date() });
    return Promise.resolve();
  }

  lastCodeFor(to: string): string | undefined {
    const entry = [...this.sent].reverse().find((e) => e.to === to);
    return entry?.code;
  }

  reset(): void {
    this.sent.length = 0;
  }
}
