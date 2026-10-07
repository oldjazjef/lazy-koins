import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { SettingsView } from '../application/settings.handlers';
import {
  DATE_FORMATS,
  type DateFormat,
  NUMBER_FORMATS,
  type NumberFormat,
} from '../domain/user-settings';

class SettingsKeysDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'CoinGecko API key; empty or null removes it',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  coingecko?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Etherscan API key' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  etherscan?: string | null;
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ example: 'ZH', description: 'Two letters or empty' })
  @IsOptional()
  @IsString()
  @Matches(/^([A-Z]{2})?$/, { message: 'canton must be a two-letter code' })
  canton?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  advisorName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @Matches(/^([^\s@]+@[^\s@]+)?$/, {
    message: 'advisorEmail must be an e-mail address',
  })
  @MaxLength(200)
  advisorEmail?: string;

  @ApiPropertyOptional({ enum: NUMBER_FORMATS })
  @IsOptional()
  @IsIn(NUMBER_FORMATS)
  numberFormat?: NumberFormat;

  @ApiPropertyOptional({ enum: DATE_FORMATS })
  @IsOptional()
  @IsIn(DATE_FORMATS)
  dateFormat?: DateFormat;

  @ApiPropertyOptional({ description: 'F11.3: rate lookups on the internet' })
  @IsOptional()
  @IsBoolean()
  onlineRates?: boolean;

  @ApiPropertyOptional({ type: SettingsKeysDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettingsKeysDto)
  keys?: SettingsKeysDto;

  @ApiPropertyOptional({
    description:
      'Symbol → CoinGecko id, e.g. { "POL": "polygon-ecosystem-token" }',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  coingeckoIds?: Record<string, string>;
}

/** Body of a key test: the typed key (unsaved, never stored); omitted = the stored key. */
export class TestKeyDto {
  @ApiPropertyOptional({ description: 'Write-only, never stored' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  key?: string;
}

export class KeyCheckResponseDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({
    enum: ['invalidKey', 'rateLimited', 'network', 'timeout', 'providerError'],
  })
  code?: 'invalidKey' | 'rateLimited' | 'network' | 'timeout' | 'providerError';
  @ApiProperty({ nullable: true, type: Number }) status!: number | null;
  @ApiProperty({ nullable: true, type: String })
  providerMessage!: string | null;
  @ApiProperty() url!: string;
  @ApiProperty() millis!: number;
}

export class SettingsResponseDto {
  @ApiProperty() displayName!: string;
  @ApiProperty() canton!: string;
  @ApiProperty() advisorName!: string;
  @ApiProperty() advisorEmail!: string;
  @ApiProperty({ enum: NUMBER_FORMATS }) numberFormat!: NumberFormat;
  @ApiProperty({ enum: DATE_FORMATS }) dateFormat!: DateFormat;
  @ApiProperty() onlineRates!: boolean;
  @ApiProperty({
    description: 'Per key a hint (`…abcd`) or null — never the key',
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
  })
  keys!: Record<string, string | null>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  coingeckoIds!: Record<string, string>;
  @ApiProperty() keyStorageAvailable!: boolean;

  static from(view: SettingsView): SettingsResponseDto {
    return {
      ...view,
      keys: { ...view.keys },
      coingeckoIds: { ...view.coingeckoIds },
    };
  }
}
