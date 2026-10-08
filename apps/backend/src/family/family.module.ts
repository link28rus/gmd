import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsentModule } from '../consent/consent.module';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { FamilyMembersController } from './family-members.controller';
import { FamilyMembersService } from './family-members.service';

@Module({
  imports: [AuthModule, PrismaModule, ConsentModule],
  controllers: [FamilyController, FamilyMembersController],
  providers: [FamilyService, FamilyMembersService],
})
export class FamilyModule {}
