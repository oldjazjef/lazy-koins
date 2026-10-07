import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TOOL_AREAS, type ToolArea } from '../../tools/domain/tool';
import { MAX_TOKEN_DAYS } from '../application/mcp-settings.handlers';

export class SaveMcpSettingsDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;

  @ApiProperty({ enum: TOOL_AREAS, isArray: true })
  @IsArray()
  @ArrayMaxSize(TOOL_AREAS.length)
  @IsIn(TOOL_AREAS, { each: true })
  areas!: ToolArea[];

  @ApiProperty({ description: 'Write and destructive tools via MCP' })
  @IsBoolean()
  allowWrite!: boolean;
}

export class CreateMcpTokenDto {
  @ApiProperty({ example: 'Claude Desktop', maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: `Days until it expires (1–${MAX_TOKEN_DAYS}); null/absent = no expiry`,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_TOKEN_DAYS)
  expiresInDays?: number | null;
}

export class AuditQueryDto {
  @ApiPropertyOptional({ enum: ['chat', 'mcp'] })
  @IsOptional()
  @IsIn(['chat', 'mcp'])
  source?: 'chat' | 'mcp';

  @ApiPropertyOptional({ default: 200, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
