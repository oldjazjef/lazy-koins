import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { KPI_KINDS, TAX_CURRENCIES } from '@lazykoins/engine';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DashboardQueryDto {
  @ApiProperty({ description: 'First day (ISO date), inclusive' })
  @Matches(ISO_DATE)
  from!: string;

  @ApiProperty({ description: 'Last day = Stichtag (ISO date), inclusive' })
  @Matches(ISO_DATE)
  to!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only this project (the compact card on a project)',
  })
  @IsOptional()
  @IsUUID()
  project?: string;

  @ApiPropertyOptional({
    example: 'CHF',
    description:
      'F4.1a: the tax currency to show — only the projects in it (absent = the newest project’s)',
  })
  @IsOptional()
  @IsIn(TAX_CURRENCIES)
  currency?: string;
}

export class DashboardRecordsQueryDto extends DashboardQueryDto {
  @ApiProperty({ enum: KPI_KINDS })
  @IsIn(KPI_KINDS)
  kpi!: string;
}

export class RefreshDashboardRatesDto extends DashboardQueryDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Assets to fetch now (one at a time shows progress); empty = FX only',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  assets?: string[];

  @ApiPropertyOptional({ description: 'Fetch again even when stored' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class DashboardResponseDto {
  @ApiProperty({
    example: 'CHF',
    description: 'F4.1a: the tax currency every amount is in',
  })
  currency!: string;
  @ApiProperty({
    type: [String],
    description:
      'Every tax currency among my projects; with several, one is shown at a time',
  })
  currencies!: string[];
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Daily totals: date, valueChf (decimal string), missing assets',
  })
  series!: unknown[];
  @ApiProperty() startValueChf!: string;
  @ApiProperty() endValueChf!: string;
  @ApiProperty() changeChf!: string;
  @ApiProperty({ nullable: true, type: String }) changePct!: string | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'deposits, withdrawals, income, costs, tradingFees with record ids',
  })
  kpis!: unknown[];
  @ApiProperty({ nullable: true, type: String }) incomeSharePct!: string | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  allocation!: unknown[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Per asset at the Stichtag, with sparkline and accounts',
  })
  holdings!: unknown[];
  @ApiProperty({ type: [String] }) missingPrices!: string[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  projects!: unknown[];
  @ApiProperty() online!: boolean;
  @ApiProperty() unreadable!: number;
}
