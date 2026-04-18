import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [FamilyController],
  providers: [FamilyService],
})
export class FamilyModule {}
