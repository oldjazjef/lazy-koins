import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * The calculation's answers are the engine's JSON as is (libs/engine `calculation/types.ts`):
 * every amount a decimal string, every figure with its record ids. OpenAPI documents the outer
 * shape; the nested types are the engine's.
 */
export class ResultResponseDto {
  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'id, inputHash, engineVersion, wealthChf, incomeChf, createdAt',
  })
  snapshot!: Record<string, unknown> | null;

  @ApiProperty({
    description: 'Files, mappings, corrections or rates changed since then',
  })
  stale!: boolean;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'CalculationResult without `records`: totals, parameters, positions, platforms, income, categories, earnGaps, oneOffEvents, checks, openItems, corrections, comparison',
  })
  result!: Record<string, unknown> | null;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'projectFileId, sha256, displayName — records name the sha256',
  })
  files!: Record<string, unknown>[];
}

export class FigureQueryDto {
  @ApiProperty({
    description:
      'A figure id from the result: pos:…, inc:…, gap:…, evt:…, plat:…, cat:… or an open item key',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  figure!: string;
}

export class FigureRecordsResponseDto {
  @ApiProperty() figureId!: string;
  @ApiProperty({
    description: 'Records behind the figure (the list may be capped)',
  })
  total!: number;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'RecordSummary + projectFileId, fileName (F7.5: file and row), correctionId',
  })
  records!: Record<string, unknown>[];
}

export class ChecksResponseDto {
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  snapshot!: Record<string, unknown> | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  checks!: Record<string, unknown>[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'OpenItem + done, note',
  })
  items!: Record<string, unknown>[];
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  comparison!: Record<string, unknown> | null;
}

export class UpdateOpenItemDto {
  @ApiProperty({ description: 'The open item key' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  key!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class OpenItemStateResponseDto {
  @ApiProperty() itemKey!: string;
  @ApiProperty() done!: boolean;
  @ApiProperty() note!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CreateCorrectionDto {
  @ApiProperty({ maxLength: 1000, description: 'Why (F9.4)' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      '{ type: price_override, asset, date, priceChf } | { type: reclassify, bookingId, kind } | { type: manual_booking, booking: {…} } | { type: manual_holding, holding: {…} } — amounts as decimal strings',
  })
  @IsObject()
  data!: Record<string, unknown>;
}

export class CorrectionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  data!: Record<string, unknown>;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true }) undoneAt!:
    string | null;
  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'status, before, after — from the latest calculation',
  })
  applied!: Record<string, unknown> | null;
}
