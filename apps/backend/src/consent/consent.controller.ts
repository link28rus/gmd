import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ConsentService } from './consent.service';
import { AcceptConsentSchema } from './dto/accept-consent.dto';
import type { AcceptConsentDto } from './dto/accept-consent.dto';

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('me/consent')
@UseGuards(JwtAuthGuard)
export class ConsentController {
  constructor(@Inject(ConsentService) private readonly consent: ConsentService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async accept(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(AcceptConsentSchema)) dto: AcceptConsentDto,
  ): Promise<void> {
    const requiresConsent = await this.consent.userRequiresConsentById(req.user.userId);
    if (!requiresConsent) {
      throw new BadRequestException({
        code: 'consent_already_accepted',
        message: 'Current policy version already accepted',
      });
    }

    const ua = req.headers['user-agent'];
    await this.consent.acceptForUser(
      req.user.userId,
      dto.documents as Parameters<ConsentService['acceptForUser']>[1],
      req.ip,
      typeof ua === 'string' ? ua : undefined,
    );
  }
}
