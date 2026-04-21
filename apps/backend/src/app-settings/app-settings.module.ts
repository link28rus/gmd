import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppSettingsService } from './app-settings.service';

@Module({
  imports: [PrismaModule],
  providers: [AppSettingsService],
  exports: [AppSettingsService],
})
export class AppSettingsModule {}
