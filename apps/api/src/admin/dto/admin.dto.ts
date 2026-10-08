import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ADMIN_LIBRARY_FILTERS,
  ADMIN_LIMITS,
  ADMIN_USER_FILTERS,
  type AdminLibraryFilter,
  type AdminUserFilter,
} from '../domain/admin';

export class AdminPageQueryDto {
  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    default: ADMIN_LIMITS.pageSize,
    minimum: 1,
    maximum: ADMIN_LIMITS.maxPageSize,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_LIMITS.maxPageSize)
  limit?: number;
}

export class AdminUsersQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ description: 'Part of the e-mail or name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: ADMIN_USER_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(ADMIN_USER_FILTERS)
  filter?: AdminUserFilter;
}

export class AdminLibraryQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({
    description: 'Part of the name, platform, pseudonym or author e-mail',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: ADMIN_LIBRARY_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(ADMIN_LIBRARY_FILTERS)
  filter?: AdminLibraryFilter;
}

export class AdminReasonDto {
  @ApiPropertyOptional({
    maxLength: ADMIN_LIMITS.maxReason,
    description: 'Required to block, delete and hide; optional otherwise',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ADMIN_LIMITS.maxReason)
  reason?: string;
}

export class SetAdminRoleDto extends AdminReasonDto {
  @ApiProperty()
  @IsBoolean()
  admin!: boolean;
}

export class DeleteUserDto extends AdminReasonDto {
  @ApiProperty({ description: "The account's e-mail address, typed again" })
  @IsString()
  @MaxLength(320)
  confirmEmail!: string;
}
