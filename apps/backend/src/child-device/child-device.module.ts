import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildDeviceController } from './child-device.controller';
import { ChildDeviceService } from './child-device.service';
import { ChildAuthGuard } from './guards/child-auth.guard';

@Module({
  imports: [PrismaModule],
  controllers: [ChildDeviceController],
  providers: [ChildDeviceService, ChildAuthGuard],
  exports: [ChildDeviceService, ChildAuthGuard],
})
export class ChildDeviceModule {}
