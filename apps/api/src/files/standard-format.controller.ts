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
import { contentDisposition } from '../common/http/raw-body.middleware';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import { buildTemplateWorkbook } from './application/template-workbook';
import { MEDIA_TYPES } from './domain/project-file';

const TYPES = ['bookings', 'holdings'] as const;

export class TemplateCsvQueryDto {
  @ApiPropertyOptional({ enum: TYPES, default: 'bookings' })
  @IsOptional()
  @IsIn(TYPES)
  type?: (typeof TYPES)[number];
}

/** The standard format "lazy-koins Buchungen v1" as downloadable templates. */
@ApiTags('standard-format')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('standard-format')
export class StandardFormatController {
  @Get('template.csv')
  @ApiOperation({
    summary: 'CSV template: Buchungen (default) or Bestände, with example rows',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string' } })
  templateCsv(@Query() query: TemplateCsvQueryDto): StreamableFile {
    const type = query.type ?? 'bookings';
    // A UTF-8 BOM so Excel opens the umlauts correctly; the importer strips it again.
    const bytes = Buffer.from(`\uFEFF${standardTemplateCsv(type)}`, 'utf8');
    const name =
      type === 'bookings'
        ? 'lazy-koins-vorlage-buchungen.csv'
        : 'lazy-koins-vorlage-bestaende.csv';
    return new StreamableFile(bytes, {
      type: `${MEDIA_TYPES.csv}; charset=utf-8`,
      length: bytes.length,
      disposition: contentDisposition(name),
    });
  }

  @Get('template.xlsx')
  @ApiOperation({
    summary:
      'XLSX template: explanation, Buchungen and Bestände sheets, a list for "Art"',
  })
  @ApiProduces(MEDIA_TYPES.xlsx)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async templateXlsx(): Promise<StreamableFile> {
    const bytes = await buildTemplateWorkbook();
    return new StreamableFile(Buffer.from(bytes), {
      type: MEDIA_TYPES.xlsx,
      length: bytes.length,
      disposition: contentDisposition('lazy-koins-vorlage.xlsx'),
    });
  }
}
