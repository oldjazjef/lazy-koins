import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  ListNotificationsQueryDto,
  NotificationCountResponseDto,
  NotificationListResponseDto,
  ReportActivityDto,
  ReportActivityResponseDto,
  ReportSyncConflictDto,
} from './dto/notification.dto';
import { NotificationCentreService } from './notification-centre.service';

/** F11.11–F11.13: the notification centre — my notifications, owner-scoped (others → 404). */
@ApiTags('notifications')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly centre: NotificationCentreService) {}

  @Get()
  @ApiOperation({
    summary:
      'My notifications, newest first, paged (status unread|all, kind, project, include resolved)',
  })
  @ApiOkResponse({ type: NotificationListResponseDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListResponseDto> {
    return (await this.centre.list(user.userId, {
      status: query.status ?? 'all',
      includeResolved: query.includeResolved ?? false,
      kind: query.kind,
      projectId: query.projectId,
      offset: query.offset ?? 0,
      limit: query.limit ?? 50,
    })) as unknown as NotificationListResponseDto;
  }

  @Get('count')
  @ApiOperation({ summary: 'The bell badge: unread and unresolved' })
  @ApiOkResponse({ type: NotificationCountResponseDto })
  count(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationCountResponseDto> {
    return this.centre.count(user.userId);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark every notification as read' })
  @ApiOkResponse({ type: NotificationCountResponseDto })
  readAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationCountResponseDto> {
    return this.centre.readAll(user.userId);
  }

  @Post('activity')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'F11.13: a task of the activity indicator finished (left page) or failed',
  })
  @ApiOkResponse({ type: ReportActivityResponseDto })
  @ApiNotFoundResponse({ description: 'Not my project' })
  activity(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportActivityDto,
  ): Promise<ReportActivityResponseDto> {
    return this.centre.reportActivity(user.userId, dto);
  }

  @Put('sync-conflict')
  @HttpCode(204)
  @ApiOperation({
    summary: 'F3.4: conflict copies the desktop app found (0 = resolved)',
  })
  @ApiNoContentResponse()
  async syncConflict(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportSyncConflictDto,
  ): Promise<void> {
    await this.centre.reportSyncConflict(user.userId, dto.count);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiOkResponse({ type: NotificationCountResponseDto })
  @ApiNotFoundResponse()
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationCountResponseDto> {
    return this.centre.read(user.userId, id);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Hide one notification (it returns when its cause changes)',
  })
  @ApiOkResponse({ type: NotificationCountResponseDto })
  @ApiNotFoundResponse()
  dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationCountResponseDto> {
    return this.centre.dismiss(user.userId, id);
  }
}
