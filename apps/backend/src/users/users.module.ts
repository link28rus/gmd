import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { ConsentModule } from '../consent/consent.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserPinController } from './user-pin.controller';
import { UserPinService } from './user-pin.service';

@Module({
  imports: [AuthModule, PrismaModule, AdminModule, ConsentModule],
  controllers: [UsersController, UserPinController],
  providers: [UsersService, UserPinService],
  exports: [UsersService, UserPinService],
})
export class UsersModule {}
