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
import { ChildrenQuerySchema, FamiliesQuerySchema, UsersQuerySchema } from './dto/pagination.dto';
import type { ChildrenQueryDto, FamiliesQueryDto, UsersQueryDto } from './dto/pagination.dto';
import { z } from 'zod';

const UpdateSettingSchema = z.object({ value: z.string().min(1).max(200) });
type UpdateSettingDto = z.infer<typeof UpdateSettingSchema>;

const SetRoleSchema = z.object({ role: z.enum(['admin', 'parent']) });
type SetRoleDto = z.infer<typeof SetRoleSchema>;

const BlockUserSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
type BlockUserDto = z.infer<typeof BlockUserSchema>;

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
    @Query(new ZodValidationPipe(FamiliesQuerySchema)) query: FamiliesQueryDto,
  ): Promise<unknown> {
    this.audit(req, '/admin/families');
    return this.admin.listFamilies(query.page, query.limit, query.q, query.showDeleted);
  }

  @Delete('families/:id')
  @HttpCode(HttpStatus.OK)
  async deleteFamily(@Req() req: AdminRequest, @Param('id') id: string): Promise<{ ok: true }> {
    this.audit(req, `DELETE /admin/families/${id}`);
    await this.admin.softDeleteFamily(id);
    return { ok: true };
  }

  @Get('children')
  async children(
    @Req() req: AdminRequest,
    @Query(new ZodValidationPipe(ChildrenQuerySchema)) query: ChildrenQueryDto,
  ): Promise<unknown> {
    this.audit(req, '/admin/children');
    return this.admin.listChildren(query.page, query.limit, query.q, query.showDeleted);
  }

  @Delete('children/:id')
  @HttpCode(HttpStatus.OK)
  async deleteChild(@Req() req: AdminRequest, @Param('id') id: string): Promise<{ ok: true }> {
    this.audit(req, `DELETE /admin/children/${id}`);
    await this.admin.softDeleteChild(id);
    return { ok: true };
  }

  @Post('children/:id/reset-device')
  @HttpCode(HttpStatus.OK)
  async resetChildDevice(@Req() req: AdminRequest, @Param('id') id: string): Promise<{ ok: true }> {
    this.audit(req, `POST /admin/children/${id}/reset-device`);
    await this.admin.resetChildDevice(id);
    return { ok: true };
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

  @Patch('users/:id/role')
  @HttpCode(HttpStatus.OK)
  async setUserRole(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetRoleSchema)) body: SetRoleDto,
  ): Promise<{ ok: true }> {
    this.audit(req, `PATCH /admin/users/${id}/role role=${body.role}`);
    await this.admin.setRole(id, body.role, req.user.userId);
    return { ok: true };
  }

  @Post('users/:id/block')
  @HttpCode(HttpStatus.OK)
  async blockUser(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(BlockUserSchema)) body: BlockUserDto,
  ): Promise<{ ok: true }> {
    this.audit(req, `POST /admin/users/${id}/block`);
    await this.admin.blockUser(id, body.reason ?? null, req.user.userId);
    return { ok: true };
  }

  @Post('users/:id/unblock')
  @HttpCode(HttpStatus.OK)
  async unblockUser(@Req() req: AdminRequest, @Param('id') id: string): Promise<{ ok: true }> {
    this.audit(req, `POST /admin/users/${id}/unblock`);
    await this.admin.unblockUser(id);
    return { ok: true };
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetUserPassword(
    @Req() req: AdminRequest,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    this.audit(req, `POST /admin/users/${id}/reset-password`);
    await this.admin.initiatePasswordReset(id);
    return { ok: true };
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  async deleteUser(@Req() req: AdminRequest, @Param('id') id: string): Promise<{ ok: true }> {
    this.audit(req, `DELETE /admin/users/${id}`);
    await this.admin.softDeleteUser(id, req.user.userId);
    return { ok: true };
  }
}
