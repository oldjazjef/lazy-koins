import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
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
    description: 'Overrides (manual) and ESTV values',
  })
  manual!: Record<string, unknown>[];
}

export class RefreshResponseDto {
  @ApiProperty({ description: 'Exchange-rate days stored' }) fx!: number;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'asset, status (fetched|cached|notFound|failed), source, points',
  })
  assets!: Record<string, unknown>[];
}
