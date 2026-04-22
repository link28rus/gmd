import { Module } from '@nestjs/common';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { MailerService } from './mailer.service';

@Module({
  imports: [AppSettingsModule],
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
