import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsentModule } from '../consent/consent.module';
import { InvitesController } from './invites.controller';
import { InvitesService, INVITES_CONFIG } from './invites.service';

function asNum(v: string | undefined, def: number): number {
  return v ? Number(v) : def;
}

@Module({
  imports: [AuthModule, PrismaModule, ConsentModule],
  controllers: [InvitesController],
  providers: [
    {
      provide: INVITES_CONFIG,
      useFactory: () => ({
        ttlSec: asNum(process.env.INVITE_TTL_SECONDS, 600),
        landingBaseUrl: process.env.CLAIM_LANDING_BASE_URL || 'https://periscop.pro',
      }),
    },
    InvitesService,
  ],
})
export class InvitesModule {}
