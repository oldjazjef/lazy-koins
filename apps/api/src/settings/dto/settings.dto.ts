import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { type Locale, SUPPORTED_LOCALES } from '../../common/i18n/locale';
import {
  PRICE_PROVIDERS,
  type PriceProviderId,
} from '../../rates/domain/price-providers';
import type { PriceSourcesView } from '../application/price-sources.handlers';
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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'CoinMarketCap API key (free Basic plan); empty or null removes it',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  coinmarketcap?: string | null;
}

class PriceSourceSettingDto {
  @ApiProperty({ enum: PRICE_PROVIDERS })
  @IsIn(PRICE_PROVIDERS)
  id!: PriceProviderId;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
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

  @ApiPropertyOptional({
    enum: SUPPORTED_LOCALES,
    description: 'F11.2: the language of the app and the exports',
  })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: Locale;

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
    type: [PriceSourceSettingDto],
    description:
      'Price sources: the crypto price providers in the order to ask them, each on or off (every id at most once; missing ones are appended off)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRICE_PROVIDERS.length)
  @ValidateNested({ each: true })
  @Type(() => PriceSourceSettingDto)
  priceSources?: PriceSourceSettingDto[];
}

export class PriceSourceViewDto {
  @ApiProperty({ enum: PRICE_PROVIDERS }) id!: PriceProviderId;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['required', 'optional', 'none'] }) key!:
    'required' | 'optional' | 'none';
  @ApiProperty({
    description: '`anyFiat` or the ISO codes it prices in',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  quotes!: 'anyFiat' | string[];
  @ApiProperty({ nullable: true, type: Number }) freeHistoryDays!:
    number | null;
  @ApiProperty({ enum: ['close', 'startOfDay'] }) dayPoint!:
    'close' | 'startOfDay';
  @ApiProperty({ enum: ['ticker', 'id'] }) coinRef!: 'ticker' | 'id';
  @ApiProperty() personalUseOnly!: boolean;
  @ApiProperty({ nullable: true, type: String }) attribution!: string | null;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Keyed providers: `…abcd` — never the key',
  })
  keyHint!: string | null;
}

export class PriceSourcesResponseDto {
  @ApiProperty({ type: [PriceSourceViewDto] }) providers!: PriceSourceViewDto[];
  @ApiProperty() keyStorageAvailable!: boolean;

  static from(view: PriceSourcesView): PriceSourcesResponseDto {
    return {
      providers: view.providers.map((p) => ({
        ...p,
        quotes: p.quotes === 'anyFiat' ? 'anyFiat' : [...p.quotes],
      })),
      keyStorageAvailable: view.keyStorageAvailable,
    };
  }
}

export class PriceSourceParamsDto {
  @ApiProperty({ enum: PRICE_PROVIDERS })
  @IsIn(PRICE_PROVIDERS)
  provider!: PriceProviderId;
}

export class PriceSourceTestResponseDto {
  @ApiProperty({ enum: PRICE_PROVIDERS }) provider!: PriceProviderId;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({
    enum: [
      'invalidKey',
      'planLacksHistory',
      'rateLimited',
      'notFound',
      'unsupportedQuote',
      'network',
      'timeout',
      'badResponse',
    ],
  })
  code?: string;
  @ApiProperty({ nullable: true, type: Number }) status!: number | null;
  @ApiProperty({ nullable: true, type: Number }) historyDays!: number | null;
  @ApiProperty({ nullable: true, type: String }) plan!: string | null;
  @ApiProperty({ nullable: true, type: String }) detail!: string | null;
  @ApiProperty() url!: string;
  @ApiProperty() millis!: number;
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
  @ApiProperty({
    enum: SUPPORTED_LOCALES,
    nullable: true,
    description: 'null = not chosen yet (the app takes the browser language)',
  })
  locale!: Locale | null;
  @ApiProperty({ enum: NUMBER_FORMATS }) numberFormat!: NumberFormat;
  @ApiProperty({ enum: DATE_FORMATS }) dateFormat!: DateFormat;
  @ApiProperty() onlineRates!: boolean;
  @ApiProperty({
    description: 'Per key a hint (`…abcd`) or null — never the key',
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
  })
  keys!: Record<string, string | null>;
  @ApiProperty({
    description:
      'F7.4: symbol → the chosen coin { provider, id, name, symbol } (changed via /settings/coins/:symbol)',
    type: 'object',
    additionalProperties: { type: 'object' },
  })
  coinChoices!: Record<
    string,
    { provider: string; id: string; name: string | null; symbol: string | null }
  >;
  @ApiProperty({
    type: [String],
    description: 'Tickers whose shared-code warning was settled ("Passt so")',
  })
  coinDismissed!: string[];
  @ApiProperty({
    description:
      'Price sources: every crypto price provider in the order they are asked, on or off',
    type: [PriceSourceSettingDto],
  })
  priceSources!: { id: PriceProviderId; enabled: boolean }[];
  @ApiProperty() keyStorageAvailable!: boolean;

  static from(view: SettingsView): SettingsResponseDto {
    return {
      ...view,
      keys: { ...view.keys },
      coinChoices: Object.fromEntries(
        Object.entries(view.coinChoices).map(([k, v]) => [k, { ...v }]),
      ),
      coinDismissed: [...view.coinDismissed],
      priceSources: view.priceSources.map((p) => ({
        id: p.id,
        enabled: p.enabled,
      })),
    };
  }
}
