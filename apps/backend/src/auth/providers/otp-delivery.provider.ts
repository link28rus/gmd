export interface OtpDeliveryProvider {
  send(to: string, code: string): Promise<void>;
}

export const OTP_DELIVERY = Symbol('OTP_DELIVERY');
