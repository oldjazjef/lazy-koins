import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  type AdminActor,
  AdminOverviewQuery,
  BlockUserCommand,
  DeleteUserCommand,
  HideLibraryEntryCommand,
  ListAdminAuditQuery,
  ListAdminLibraryQuery,
  ListAdminUsersQuery,
  SetUserAdminCommand,
} from './application/admin.handlers';
import type {
  AdminAuditEntry,
  AdminLibraryEntry,
  AdminOverview,
  AdminUser,
  Page,
} from './domain/admin';
import {
  AdminLibraryQueryDto,
  AdminPageQueryDto,
  AdminReasonDto,
  AdminUsersQueryDto,
  DeleteUserDto,
  SetAdminRoleDto,
} from './dto/admin.dto';
import { PlatformAdminGuard } from './platform-admin.guard';

function actorOf(user: AuthenticatedUser): AdminActor {
  return { userId: user.userId, email: user.email };
}

/**
 * The management pages (platform admins, web only): overview, accounts (block, admin role,
 * delete), moderation of the public library, the audit log. Metadata only — no endpoint reads
 * another user's projects, files, transactions or settings. Every change is audited.
 */
@ApiTags('admin')
@ApiBearerAuth(BEARER_SCHEME)
@ApiForbiddenResponse({ description: 'body.code: adminOnly' })
@UseGuards(PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Counts: users, activity, projects, storage, library',
  })
  @ApiOkResponse({ description: 'AdminOverview' })
  overview(): Promise<AdminOverview> {
    return this.queries.execute(new AdminOverviewQuery());
  }

  @Get('users')
  @ApiOperation({
    summary: 'Accounts (metadata and counts only), newest first',
  })
  @ApiOkResponse({ description: '{ items: AdminUser[], total }' })
  users(@Query() q: AdminUsersQueryDto): Promise<Page<AdminUser>> {
    return this.queries.execute(
      new ListAdminUsersQuery(q.q, q.filter, q.offset, q.limit),
    );
  }

  @Post('users/:id/block')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Block an account (reason required) — every request of it answers 403 accountBlocked',
  })
  block(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminReasonDto,
  ): Promise<AdminUser> {
    return this.commands.execute(
      new BlockUserCommand(actorOf(user), id, true, body.reason),
    );
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unblock an account' })
  unblock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminReasonDto,
  ): Promise<AdminUser> {
    return this.commands.execute(
      new BlockUserCommand(actorOf(user), id, false, body.reason),
    );
  }

  @Put('users/:id/admin')
  @ApiOperation({ summary: 'Grant or revoke the admin role (never your own)' })
  setAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetAdminRoleDto,
  ): Promise<AdminUser> {
    return this.commands.execute(
      new SetUserAdminCommand(actorOf(user), id, body.admin, body.reason),
    );
  }

  @Delete('users/:id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete an account and everything it owns (reason + its e-mail typed again; never an admin or yourself)',
  })
  @ApiNoContentResponse()
  async deleteUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeleteUserDto,
  ): Promise<void> {
    await this.commands.execute(
      new DeleteUserCommand(actorOf(user), id, body.reason, body.confirmEmail),
    );
  }

  @Get('library')
  @ApiOperation({
    summary: 'Library entries (also hidden ones) with the author e-mail',
  })
  @ApiOkResponse({ description: '{ items: AdminLibraryEntry[], total }' })
  library(@Query() q: AdminLibraryQueryDto): Promise<Page<AdminLibraryEntry>> {
    return this.queries.execute(
      new ListAdminLibraryQuery(q.q, q.filter, q.offset, q.limit),
    );
  }

  @Post('library/:id/hide')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Hide a library entry (reason required; the author is notified)',
  })
  hide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminReasonDto,
  ): Promise<AdminLibraryEntry> {
    return this.commands.execute(
      new HideLibraryEntryCommand(actorOf(user), id, true, body.reason),
    );
  }

  @Post('library/:id/unhide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Show a hidden library entry again' })
  unhide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminReasonDto,
  ): Promise<AdminLibraryEntry> {
    return this.commands.execute(
      new HideLibraryEntryCommand(actorOf(user), id, false, body.reason),
    );
  }

  @Get('audit')
  @ApiOperation({ summary: 'Every admin action, newest first' })
  @ApiOkResponse({ description: '{ items: AdminAuditEntry[], total }' })
  audit(@Query() q: AdminPageQueryDto): Promise<Page<AdminAuditEntry>> {
    return this.queries.execute(new ListAdminAuditQuery(q.offset, q.limit));
  }
}
