import { Controller, Get, HttpStatus, Inject, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GeoIpService } from './geoip.service';
import type { IpCenter } from './geoip.service';

@Controller('geo')
@UseGuards(JwtAuthGuard)
export class GeoController {
  constructor(@Inject(GeoIpService) private readonly geoip: GeoIpService) {}

  /**
   * v0.64.0: запасной центр карты — город по IP клиента. Под /api/geo/* Caddy
   * шлёт запрос прямо в backend, req.ip реальный (trust proxy). Приватный IP,
   * нет в базе или база не загружена — 204.
   */
  @Get('ip-center')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  ipCenter(@Req() req: Request, @Res({ passthrough: true }) res: Response): IpCenter | undefined {
    const center = this.geoip.lookup(req.ip);
    if (!center) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return center;
  }
}
