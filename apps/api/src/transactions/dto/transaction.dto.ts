import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BOOKING_KINDS, type BookingKind } from '@lazykoins/engine';
import { AI_REVIEW_MAX } from '../domain/ai-review';
import {
  MAX_BULK_EDIT,
  MAX_TRANSACTION_PAGE,
} from '../application/transactions.handlers';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const asBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

/** F9.5 filter. */
export class TransactionsQueryDto {
  @ApiPropertyOptional({ example: '2025-01-01' })
  @IsOptional()
  @Matches(ISO_DAY)
  from?: string;

  @ApiPropertyOptional({ example: '2025-12-31' })
  @IsOptional()
  @Matches(ISO_DAY)
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  account?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  asset?: string;

  @ApiPropertyOptional({ enum: BOOKING_KINDS })
  @IsOptional()
  @IsIn(BOOKING_KINDS)
  kind?: BookingKind;

  @ApiPropertyOptional({ description: 'Only changed ones' })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  changed?: boolean;

  @ApiPropertyOptional({
    description: 'Only "unbekannt" / to review (open AI suggestions included)',
  })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  review?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'F9.7: one wallet' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  walletId?: string;

  @ApiPropertyOptional({
    description:
      'Words that must all appear (asset, reference, note, platform type, platform, account)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_TRANSACTION_PAGE,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_TRANSACTION_PAGE)
  limit?: number;
}

export class TransactionKeyQueryDto {
  @ApiProperty({ description: 'The stable transaction key' })
  @IsString()
  @MaxLength(300)
  key!: string;
}

export class TransactionsPageDto {
  @ApiProperty({ description: 'Currency of every value' }) currency!: string;
  @ApiProperty() total!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'key, timestamp, platform, accountId, kind (+ originalKind), asset (+ originalAsset), quantity, fee, feeAsset, value, group, note, rawType, source {fileId, fileName, row, walletId}, status original | changed | aiSuggested, hidden, linkedKey, suggestion, projects, lockedBy',
  })
  rows!: Record<string, unknown>[];
  @ApiProperty({ type: [String] }) platforms!: string[];
  @ApiProperty({ type: [String] }) accounts!: string[];
  @ApiProperty({ type: [String] }) assets!: string[];
  @ApiProperty() unreadable!: number;
}

export class TransactionDetailDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  transaction!: Record<string, unknown>;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
    description: 'The original row of the file (F7.5)',
  })
  raw!: Record<string, string> | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  history!: Record<string, unknown>[];
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  linked!: Record<string, unknown> | null;
}

export class EditTransactionsDto {
  @ApiProperty({ type: [String], maxItems: MAX_BULK_EDIT })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_EDIT)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  keys!: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'libs/engine TransactionChangesSchema: kind?, asset?, note?, hidden?, linkedKey? (null = unlink)',
  })
  @IsObject()
  changes!: Record<string, unknown>;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class EditResultDto {
  @ApiProperty() edited!: number;
  @ApiProperty({ type: [String] }) projectIds!: string[];
}

export class TransactionKeysDto {
  @ApiPropertyOptional({
    type: [String],
    maxItems: AI_REVIEW_MAX,
    description: 'Empty = every "unbekannt" (newest first)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_REVIEW_MAX)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  keys?: string[];
}

export class SuggestTransactionsDto extends TransactionKeysDto {
  @ApiPropertyOptional({
    description: 'F5.14: consent to sending the shown payload',
  })
  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

export class DecideSuggestionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_EDIT)
  @IsString({ each: true })
  ids!: string[];

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class KindRuleDto {
  @ApiProperty() @IsString() @MaxLength(300) key!: string;
  @ApiProperty({ enum: BOOKING_KINDS })
  @IsIn(BOOKING_KINDS)
  kind!: BookingKind;
}
