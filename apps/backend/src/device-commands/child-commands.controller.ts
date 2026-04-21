import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChildAuthGuard } from '../child-device/guards/child-auth.guard';
import type { ChildAuthContext } from '../child-device/child-device.service';
import { DeviceCommandsService } from './device-commands.service';

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

@Controller('child/commands')
@UseGuards(ChildAuthGuard)
export class ChildCommandsController {
  constructor(@Inject(DeviceCommandsService) private readonly svc: DeviceCommandsService) {}

  // Лимит поллинга командой щедрый: child пуллит после каждого ingest
  // (≈ 2/мин) + может спонтанно дёрнуть при возврате приложения из фона.
  @Get('pending')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async listPending(@Req() req: ChildRequest): Promise<{
    commands: Array<{ id: string; type: string; payload: unknown; createdAt: string }>;
  }> {
    const commands = await this.svc.listPending(req.childDevice.deviceId);
    return { commands };
  }

  @Post(':id/ack')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async ack(@Req() req: ChildRequest, @Param('id') id: string): Promise<void> {
    await this.svc.ackCommand(req.childDevice.deviceId, id);
  }
}
