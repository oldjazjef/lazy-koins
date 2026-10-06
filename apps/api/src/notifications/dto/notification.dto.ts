import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  NAMED_ACTIONS,
  NOTIFICATION_KINDS,
  NOTIFICATION_STATUSES,
} from '../domain/notification';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    enum: NOTIFICATION_STATUSES,
    default: 'all',
    description: 'unread = not read yet',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: (typeof NOTIFICATION_STATUSES)[number];

  @ApiPropertyOptional({
    default: false,
    description: 'Also notifications whose cause is gone ("erledigte")',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeResolved?: boolean;

  @ApiPropertyOptional({ enum: NOTIFICATION_KINDS })
  @IsOptional()
  @IsIn(NOTIFICATION_KINDS)
  kind?: (typeof NOTIFICATION_KINDS)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class NotificationActionDto {
  @ApiProperty({ description: 'i18n key of the button' }) labelKey!: string;
  @ApiProperty({ description: 'App route under /app/' }) route!: string;
  @ApiPropertyOptional({ type: Object }) query?: Record<string, string>;
  @ApiPropertyOptional() fragment?: string;
  @ApiPropertyOptional({ enum: NAMED_ACTIONS }) named?: string;
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  projectId!: string | null;
  @ApiProperty({ type: String, nullable: true }) projectName!: string | null;
  @ApiProperty({ enum: NOTIFICATION_KINDS }) kind!: string;
  @ApiProperty({
    description:
      'Stable key, `<area>.<what>[:<subject>]` — one notification per topic',
  })
  topic!: string;
  @ApiProperty({ description: 'i18n key' }) titleKey!: string;
  @ApiProperty({
    type: Object,
    description: 'i18n params — never keys or booking details',
  })
  params!: Record<string, string | number | boolean | null>;
  @ApiProperty({ type: NotificationActionDto, nullable: true })
  action!: NotificationActionDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  readAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  resolvedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  dismissedAt!: string | null;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[];
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'Unread, unresolved' }) unread!: number;
}

export class NotificationCountResponseDto {
  @ApiProperty() unread!: number;
}

export class ReportActivityDto {
  @ApiProperty({ description: 'The activity label (`activity.*` i18n key)' })
  @IsString()
  @Matches(/^activity\.[a-zA-Z]+(?:\.[a-zA-Z]+)?$/)
  label!: string;

  @ApiProperty({ enum: ['success', 'error'] })
  @IsIn(['success', 'error'])
  outcome!: 'success' | 'error';

  @ApiPropertyOptional({
    type: Object,
    description: 'The label params (sanitised: short, no secrets)',
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Where the task started (/app/…)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  route?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  query?: Record<string, string>;
}

export class ReportActivityResponseDto {
  @ApiProperty({
    description: 'false = not stored (the server already reported the error)',
  })
  notified!: boolean;
}

export class ReportSyncConflictDto {
  @ApiProperty({ minimum: 0, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  count!: number;
}
