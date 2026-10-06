import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ASSET = /^[A-Za-z0-9.]{1,40}$/;

export class RatesQueryDto {
  @ApiPropertyOptional({
    description: 'Only this asset, every stored point',
    example: 'BTC',
  })
  @IsOptional()
  @IsString()
  @Matches(ASSET)
  asset?: string;
}

export class RefreshRatesDto {
  @ApiPropertyOptional({
    description: 'Fetch again even when stored (default false)',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class ManualRateDto {
  @ApiProperty({ enum: ['price', 'fx'] })
  @IsIn(['price', 'fx'])
  kind!: 'price' | 'fx';

  @ApiProperty({ example: 'BTC', description: 'Asset, or USD/EUR for fx' })
  @IsString()
  @Matches(ASSET)
  asset!: string;

  @ApiProperty({ enum: ['CHF', 'USD'] })
  @IsIn(['CHF', 'USD'])
  currency!: 'CHF' | 'USD';

  @ApiProperty({ example: '2025-12-31' })
  @IsString()
  @Matches(ISO_DATE)
  date!: string;

  @ApiProperty({ example: '85000.50', description: 'Decimal string' })
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'value must be a decimal like 0.8123' })
  value!: string;
}

export class DeleteRateQueryDto {
  @ApiProperty({ enum: ['price', 'fx'] })
  @IsIn(['price', 'fx'])
  kind!: 'price' | 'fx';

  @ApiProperty()
  @IsString()
  @Matches(ASSET)
  asset!: string;

  @ApiProperty({ enum: ['CHF', 'USD'] })
  @IsIn(['CHF', 'USD'])
  currency!: 'CHF' | 'USD';

  @ApiProperty()
  @IsString()
  @Matches(ISO_DATE)
  date!: string;

  @ApiProperty({ enum: ['manual', 'estv'] })
  @IsIn(['manual', 'estv'])
  source!: 'manual' | 'estv';
}

export class RatesResponseDto {
  @ApiProperty() taxYear!: number;
  @ApiProperty({ description: 'Rate lookups on the internet allowed (F11.3)' })
  online!: boolean;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Per kind/asset/currency/source: points, from, to, yearEnd {date, value}, fetchedAt',
  })
  series!: Record<string, unknown>[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Overrides (manual) and ESTV values (note = the ESTV label)',
  })
  manual!: Record<string, unknown>[];
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'F7.4a: autoEnabled, available (stored label), cryptoCount, applied (label in use), outdated',
  })
  estv!: Record<string, unknown>;
}

export class RefreshResponseDto {
  @ApiProperty({ description: 'Exchange-rate days stored' }) fx!: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'F7.4a: the stored ESTV Kursliste applied (EstvApplyResponseDto)',
  })
  estv!: Record<string, unknown>;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'asset, status (fetched|cached|notFound|failed), source, points',
  })
  assets!: Record<string, unknown>[];
}

export class RefreshStatusResponseDto {
  @ApiProperty({ description: 'A refresh of this project is in flight' })
  running!: boolean;
  @ApiProperty({ description: 'Series handled so far (FX + assets)' })
  done!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ type: String, nullable: true }) current!: string | null;
}

export class EstvUpdateDto {
  @ApiPropertyOptional({
    description: 'Only this tax year; absent = every stored year and last year',
    example: 2025,
  })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class EstvStatusResponseDto {
  @ApiProperty({
    description:
      'Downloads allowed by the deployment (ESTV_AUTO, RATES_ONLINE)',
  })
  autoEnabled!: boolean;
  @ApiProperty({
    description: "The user's rate lookups (F11.3) and RATES_ONLINE",
  })
  online!: boolean;
  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description:
      'A running update: years, year, startedAt, progress {phase, bytes, totalBytes, entries}',
  })
  running!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: String }) lastCheckAt!: string | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Per tax year: version {exportType, exportDate, fileHash, schemaVersion, downloadedAt, entryCount, cryptoCount, fxCount, label} and check {checkedAt, outcome, error}',
  })
  years!: Record<string, unknown>[];
}

export class EstvApplyResponseDto {
  @ApiProperty() year!: number;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ESTV-Kursliste <Jahr>, Stand <Datum>; null = none stored',
  })
  label!: string | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'asset, symbol, name, value (CHF at 31.12.)',
  })
  matched!: Record<string, unknown>[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'asset, candidates — several entries fit, no value taken',
  })
  ambiguous!: Record<string, unknown>[];
  @ApiProperty({ type: [String], description: 'Year-end exchange rates taken' })
  fx!: string[];
}
