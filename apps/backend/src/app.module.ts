import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { FamilyModule } from './family/family.module';

@Module({
  imports: [PrismaModule, RedisModule, AuthModule, UsersModule, FamilyModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
