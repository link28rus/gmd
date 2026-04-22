import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsentModule } from '../consent/consent.module';
import { AuthModule } from '../auth/auth.module';
import { ChildDeviceController } from './child-device.controller';
import { ChildDeviceService } from './child-device.service';
import { ChildAuthGuard } from './guards/child-auth.guard';

@Module({
  imports: [PrismaModule, ConsentModule, AuthModule],
  controllers: [ChildDeviceController],
  providers: [ChildDeviceService, ChildAuthGuard],
  exports: [ChildDeviceService, ChildAuthGuard],
})
export class ChildDeviceModule {}
