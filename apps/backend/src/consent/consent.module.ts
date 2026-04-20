import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';
import { ConsentRequiredGuard } from './guards/consent-required.guard';
import { AuthModule } from '../auth/auth.module';
import { CONSENT_CONFIG } from './consent.tokens';
import type { ConsentConfig } from './consent.tokens';

export { CONSENT_CONFIG };
export type { ConsentConfig };

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ConsentController],
  providers: [
    {
      provide: CONSENT_CONFIG,
      useFactory: (): ConsentConfig => ({
        privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION || '1.1',
      }),
    },
    ConsentService,
    ConsentRequiredGuard,
  ],
  exports: [ConsentService, ConsentRequiredGuard, CONSENT_CONFIG],
})
export class ConsentModule {}
