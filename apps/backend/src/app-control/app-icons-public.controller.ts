import { Controller, Get, Header, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppControlService } from './app-control.service';

/**
 * Public раздача иконок приложений по sha256 (content-addressable).
 *
 * Не требует auth — иконки не содержат PII (это просто иконки приложений
 * вроде TikTok / WhatsApp / Chrome), а enumeration защищён криптостойким
 * sha256 (нельзя перебрать).
 *
 * Кэшируется immutable на год — sha256 гарантирует что content не меняется.
 *
 * Throttle: 600/мин на IP — для предотвращения hot-loop'а при ошибке клиента.
 */
@Controller('app-icons')
export class AppIconsPublicController {
  constructor(@Inject(AppControlService) private readonly svc: AppControlService) {}

  @Get(':sha256')
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getIcon(@Param('sha256') sha256: string, @Res() res: Response): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new NotFoundException({ code: 'icon_not_found', message: 'invalid sha256' });
    }
    const bytes = await this.svc.getIconBytes(sha256);
    if (!bytes) {
      throw new NotFoundException({ code: 'icon_not_found', message: 'icon not cached' });
    }
    res.send(bytes);
  }
}
