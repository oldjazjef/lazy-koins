import {
  TRANSACTION_SCOPES,
  type TransactionScope,
} from '../application/transactions.handlers';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BOOKING_TREATMENTS, type BookingTreatment } from '@lazykoins/engine';

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

/** The project header's calculation line (F7.6). */
export class ResultStatusResponseDto {
  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'The latest calculation; null = never calculated',
  })
  calculatedAt!: string | null;

  @ApiProperty({
    description:
      'Files, mappings, corrections, rates, wallets or the currency changed since then (false without a calculation)',
  })
  stale!: boolean;
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

export class TransactionsQueryDto {
  @ApiPropertyOptional({
    enum: TRANSACTION_SCOPES,
    default: 'year',
    description:
      'F9.6: year = the tax year; all = also earlier bookings that decide a balance at 31.12.',
  })
  @IsOptional()
  @IsIn(TRANSACTION_SCOPES)
  scope?: TransactionScope;

  @ApiPropertyOptional({
    description:
      'Words that must all appear (asset, platform, account, kind, raw type, note, file, id, reason)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: BOOKING_TREATMENTS })
  @IsOptional()
  @IsIn(BOOKING_TREATMENTS)
  treatment?: BookingTreatment;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  platform?: string;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class TransactionsResponseDto {
  @ApiProperty() taxYear!: number;
  @ApiProperty({ description: 'Tax currency of every valueChf (F4.1a)' })
  currency!: string;
  @ApiProperty({ description: 'Rows matching the filter, before paging' })
  total!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Per treatment, the treatment filter aside',
  })
  counts!: Record<string, number>;
  @ApiProperty({ type: [String] }) platforms!: string[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'libs/engine BookingTreatmentRow (treatment: income | oneOff | balance | checkOnly | transfer | spam | unknown | afterYear | excluded; valueChf, figureIds, correctionId + reason) + projectFileId, fileName',
  })
  rows!: Record<string, unknown>[];
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
      '{ type: price_override, asset, date, priceChf } | { type: reclassify, bookingId, kind } | { type: manual_booking, booking: {…} } | { type: manual_holding, holding: {…} } | { type: exclude_booking, bookingId } — amounts as decimal strings',
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
