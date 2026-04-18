import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { FamilyModule } from './family/family.module';
import { ChildrenModule } from './children/children.module';
import { InvitesModule } from './invites/invites.module';
import { ChildDeviceModule } from './child-device/child-device.module';
import { AdminModule } from './admin/admin.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
        storage: new RedisThrottlerStorage(
          new Redis(process.env.REDIS_URL || 'redis://localhost:6379'),
        ),
      }),
    }),
    AuthModule,
    UsersModule,
    FamilyModule,
    ChildrenModule,
    InvitesModule,
    ChildDeviceModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
