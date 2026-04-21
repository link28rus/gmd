import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { AdminGuard } from './guards/admin.guard';
import { AdminService } from './admin.service';
import { PaginationSchema, UsersQuerySchema } from './dto/pagination.dto';
import type { PaginationDto, UsersQueryDto } from './dto/pagination.dto';
import { z } from 'zod';

const UpdateSettingSchema = z.object({ value: z.string().min(1).max(200) });
type UpdateSettingDto = z.infer<typeof UpdateSettingSchema>;

interface AdminRequest extends Request {
  user: { userId: string; email: string; familyId: string; role: string };
}

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
  ) {}

  private audit(req: AdminRequest, path: string): void {
    this.logger.log(`admin access: email=${req.user.email} path=${path}`);
  }

  @Get('stats')
  async stats(@Req() req: AdminRequest): Promise<unknown> {
    this.audit(req, '/admin/stats');
    return this.admin.getStats();
  }

  @Get('users')
  async users(
    @Req() req: AdminRequest,
    @Query(new ZodValidationPipe(UsersQuerySchema)) query: UsersQueryDto,
  ): Promise<unknown> {
    this.audit(req, '/admin/users');
    return this.admin.listUsers(query.page, query.limit, query.q);
  }

  @Get('users/:id')
  async userDetail(@Req() req: AdminRequest, @Param('id') id: string): Promise<unknown> {
    this.audit(req, `/admin/users/${id}`);
    return this.admin.getUserDetail(id);
  }

  @Get('families')
  async families(
    @Req() req: AdminRequest,
    @Query(new ZodValidationPipe(PaginationSchema)) query: PaginationDto,
  ): Promise<unknown> {
    this.audit(req, '/admin/families');
    return this.admin.listFamilies(query.page, query.limit);
  }

  @Get('children')
  async children(
    @Req() req: AdminRequest,
    @Query(new ZodValidationPipe(PaginationSchema)) query: PaginationDto,
  ): Promise<unknown> {
    this.audit(req, '/admin/children');
    return this.admin.listChildren(query.page, query.limit);
  }

  @Get('invites')
  async invites(@Req() req: AdminRequest): Promise<unknown> {
    this.audit(req, '/admin/invites');
    return this.admin.listActiveInvites();
  }

  @Get('settings')
  async listSettings(@Req() req: AdminRequest): Promise<unknown> {
    this.audit(req, '/admin/settings');
    const settings = await this.settings.list();
    return { settings };
  }

  @Patch('settings/:key')
  @HttpCode(HttpStatus.OK)
  async updateSetting(
    @Req() req: AdminRequest,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateSettingSchema)) body: UpdateSettingDto,
  ): Promise<unknown> {
    this.audit(req, `/admin/settings/${key}`);
    await this.settings.update(key, body.value, req.user.email);
    return { ok: true };
  }
}
