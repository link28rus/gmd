import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ParentDevicesController } from './parent-devices.controller';
import { ParentDevicesService } from './parent-devices.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ParentDevicesController],
  providers: [ParentDevicesService],
  exports: [ParentDevicesService],
})
export class ParentDevicesModule {}
