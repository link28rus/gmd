import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { DiagService } from './diag.service';
import type { ChildDiagView, DiagUploadView } from './diag.service';
import type { DiagConfig } from './diag-config';
import { DiagConfigSchema } from './dto/diag.dto';
import type { DiagConfigDto } from './dto/diag.dto';

interface AdminRequest extends Request {
  user: { userId: string; email: string; familyId: string; role: string };
}

/**
 * v0.60: журнал приложения ребёнка — только администратор (в журнале бывают
 * координаты и события, родителям он не показывается).
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminDiagController {
  private readonly logger = new Logger(AdminDiagController.name);

  constructor(@Inject(DiagService) private readonly svc: DiagService) {}

  private audit(req: AdminRequest, path: string): void {
    this.logger.log(`admin access: email=${req.user.email} path=${path}`);
  }

  @Get('children/:id/diag')
  async childDiag(@Req() req: AdminRequest, @Param('id') id: string): Promise<ChildDiagView> {
    this.audit(req, `/admin/children/${id}/diag`);
    return this.svc.getChildDiag(id);
  }

  @Patch('children/:id/diag/config')
  @HttpCode(HttpStatus.OK)
  async updateConfig(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DiagConfigSchema)) body: DiagConfigDto,
  ): Promise<{ config: DiagConfig; delivered: boolean }> {
    this.audit(req, `PATCH /admin/children/${id}/diag/config`);
    return this.svc.updateConfig(id, body);
  }

  @Post('children/:id/diag/request')
  @HttpCode(HttpStatus.OK)
  async requestUpload(
    @Req() req: AdminRequest,
    @Param('id') id: string,
  ): Promise<{ commandId: string; delivered: boolean; expiresAt: string }> {
    this.audit(req, `POST /admin/children/${id}/diag/request`);
    return this.svc.requestUpload(id, req.user.userId);
  }

  @Get('diag/uploads/:uploadId')
  async upload(
    @Req() req: AdminRequest,
    @Param('uploadId') uploadId: string,
  ): Promise<DiagUploadView> {
    this.audit(req, `/admin/diag/uploads/${uploadId}`);
    return this.svc.getUpload(uploadId);
  }

  @Delete('diag/uploads/:uploadId')
  @HttpCode(HttpStatus.OK)
  async deleteUpload(
    @Req() req: AdminRequest,
    @Param('uploadId') uploadId: string,
  ): Promise<{ ok: true }> {
    this.audit(req, `DELETE /admin/diag/uploads/${uploadId}`);
    await this.svc.deleteUpload(uploadId);
    return { ok: true };
  }
}
