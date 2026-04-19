import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';
import { AuthModule } from '../auth/auth.module';

export const CONSENT_CONFIG = Symbol('CONSENT_CONFIG');

export interface ConsentConfig {
  privacyPolicyVersion: string;
}

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ConsentController],
  providers: [
    {
      provide: CONSENT_CONFIG,
      useFactory: (): ConsentConfig => ({
        privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION || '1.0',
      }),
    },
    ConsentService,
  ],
  exports: [ConsentService, CONSENT_CONFIG],
})
export class ConsentModule {}
