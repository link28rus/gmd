import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';
import { ADMIN_CONFIG } from './admin.tokens';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AdminController],
  providers: [
    {
      provide: ADMIN_CONFIG,
      useFactory: () => ({
        emails: (process.env.ADMIN_EMAILS || '')
          .split(',')
          .map((s) => s.toLowerCase().trim())
          .filter(Boolean),
      }),
    },
    AdminGuard,
    AdminService,
  ],
  exports: [ADMIN_CONFIG],
})
export class AdminModule {}
