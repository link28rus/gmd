import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChildAuthGuard } from '../child-device/guards/child-auth.guard';
import type { ChildAuthContext } from '../child-device/child-device.service';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { DiagService } from './diag.service';
import type { DiagConfig } from './diag-config';
import { UploadDiagLogSchema } from './dto/diag.dto';
import type { UploadDiagLogDto } from './dto/diag.dto';

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

@Controller('child/diag')
@UseGuards(ChildAuthGuard)
export class ChildDiagController {
  constructor(@Inject(DiagService) private readonly svc: DiagService) {}

  // Телефон забирает настройки при старте службы геолокации (дубль к
  // DIAG_CONFIG по мгновенному каналу — на случай, если канал не поднялся).
  @Get('config')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async config(@Req() req: ChildRequest): Promise<DiagConfig> {
    return this.svc.getConfigForDevice(req.childDevice.deviceId);
  }

  // Журнал: JSON (допускается Content-Encoding: gzip — express.json в main.ts
  // распаковывает сам, лимит тела 10 МБ). Автоотправка на телефоне ограничена
  // сама, 20 в час — страховка от зацикливания.
  @Post('logs')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 3600_000, limit: 20 } })
  async upload(
    @Req() req: ChildRequest,
    @Body(new ZodValidationPipe(UploadDiagLogSchema)) dto: UploadDiagLogDto,
  ): Promise<{ id: string }> {
    return this.svc.saveUpload(
      { deviceId: req.childDevice.deviceId, childId: req.childDevice.childId },
      dto,
    );
  }
}
