import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { standardTemplateCsv } from '@lazykoins/engine';
import { IsIn, IsOptional } from 'class-validator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { contentDisposition } from '../common/http/raw-body.middleware';
import {
  type Locale,
  localeOr,
  SUPPORTED_LOCALES,
} from '../common/i18n/locale';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { UserSettingsRepositoryPort } from '../settings/ports/user-settings.repository.port';
import { buildTemplateWorkbook } from './application/template-workbook';
import { MEDIA_TYPES } from './domain/project-file';

const TYPES = ['bookings', 'holdings'] as const;
const BOM = String.fromCharCode(0xfeff);

export class TemplateLanguageQueryDto {
  @ApiPropertyOptional({
    enum: SUPPORTED_LOCALES,
    description:
      'F11.2: language of the explanations and example notes; default the user’s language. The column headers stay German (they are the format).',
  })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  language?: Locale;
}

export class TemplateCsvQueryDto extends TemplateLanguageQueryDto {
  @ApiPropertyOptional({ enum: TYPES, default: 'bookings' })
  @IsOptional()
  @IsIn(TYPES)
  type?: (typeof TYPES)[number];
}

/** File names of the downloads per language (the content's column names stay German). */
const FILE_NAMES: Readonly<
  Record<Locale, Record<'bookings' | 'holdings' | 'xlsx', string>>
> = {
  'de-CH': {
    bookings: 'lazy-koins-vorlage-buchungen.csv',
    holdings: 'lazy-koins-vorlage-bestaende.csv',
    xlsx: 'lazy-koins-vorlage.xlsx',
  },
  en: {
    bookings: 'lazy-koins-template-bookings.csv',
    holdings: 'lazy-koins-template-holdings.csv',
    xlsx: 'lazy-koins-template.xlsx',
  },
};

/** The standard format "lazy-koins Buchungen v1" as downloadable templates. */
@ApiTags('standard-format')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('standard-format')
export class StandardFormatController {
  constructor(private readonly settings: UserSettingsRepositoryPort) {}

  @Get('template.csv')
  @ApiOperation({
    summary: 'CSV template: Buchungen (default) or Bestände, with example rows',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string' } })
  async templateCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TemplateCsvQueryDto,
  ): Promise<StreamableFile> {
    const type = query.type ?? 'bookings';
    const language = await this.languageOf(user.userId, query.language);
    // A UTF-8 BOM so Excel opens the umlauts correctly; the importer strips it again.
    const bytes = Buffer.from(
      BOM + standardTemplateCsv(type, language),
      'utf8',
    );
    return new StreamableFile(bytes, {
      type: `${MEDIA_TYPES.csv}; charset=utf-8`,
      length: bytes.length,
      disposition: contentDisposition(FILE_NAMES[language][type]),
    });
  }

  @Get('template.xlsx')
  @ApiOperation({
    summary:
      'XLSX template: explanation, Buchungen and Bestände sheets, a list for "Art"',
  })
  @ApiProduces(MEDIA_TYPES.xlsx)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async templateXlsx(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TemplateLanguageQueryDto,
  ): Promise<StreamableFile> {
    const language = await this.languageOf(user.userId, query.language);
    const bytes = await buildTemplateWorkbook(language);
    return new StreamableFile(Buffer.from(bytes), {
      type: MEDIA_TYPES.xlsx,
      length: bytes.length,
      disposition: contentDisposition(FILE_NAMES[language].xlsx),
    });
  }

  /** F11.2: the requested language, else the user's, else German. */
  private async languageOf(
    userId: string,
    requested: Locale | undefined,
  ): Promise<Locale> {
    if (requested) return requested;
    return localeOr((await this.settings.find(userId))?.locale);
  }
}
