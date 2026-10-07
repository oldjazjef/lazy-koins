import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  SAMPLE_UPLOAD_LIMITS,
  sampleBodySchema,
  SampleFormDto,
  sampleFromUpload,
  SampleInspectionResponseDto,
  SamplePreviewFormDto,
  SamplePreviewResponseDto,
  type UploadedSample,
} from './dto/mapping-sample.dto';
import { MappingsService } from './mappings.service';

/**
 * The live preview runs while the user types (debounced in the app) and stores nothing: a looser
 * per-account budget than other writes. The per-IP budget still applies.
 */
const PREVIEW_BUDGET = { writes: { limit: 600, ttl: 10 * 60_000 } };

@ApiTags('mappings')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('mapping-samples')
export class MappingSamplesController {
  constructor(private readonly mappings: MappingsService) {}

  @Post('inspect')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', SAMPLE_UPLOAD_LIMITS))
  @ApiOperation({
    summary:
      'A sample file for the mapping editor: raw table, header guess, spec skeleton — nothing is stored',
    description:
      'multipart/form-data with `file` (CSV/XLSX, ≤ 20 MB). The bytes are read in memory and dropped; the file is not added to any project.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: sampleBodySchema() })
  @ApiOkResponse({ type: SampleInspectionResponseDto })
  @ApiPayloadTooLargeResponse({ description: 'Larger than 20 MB' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Not CSV or XLSX' })
  @ApiUnprocessableEntityResponse({
    description: 'A PDF, or an unreadable workbook',
  })
  async inspect(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedSample | undefined,
    @Body() dto: SampleFormDto,
  ): Promise<SampleInspectionResponseDto> {
    return SampleInspectionResponseDto.from(
      await this.mappings.inspectSample(
        user.userId,
        sampleFromUpload(file, dto.name),
      ),
    );
  }

  @Post('preview')
  @HttpCode(200)
  @Throttle(PREVIEW_BUDGET)
  @UseInterceptors(FileInterceptor('file', SAMPLE_UPLOAD_LIMITS))
  @ApiOperation({
    summary:
      'What an unsaved spec makes of a sample file, and whether an upload would recognise it — nothing is stored',
    description:
      'An invalid spec is not an error here: `valid: false` with its issues (the editor previews while typing).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: sampleBodySchema({
      spec: { type: 'string', description: 'The spec as JSON text' },
      limit: { type: 'integer', description: 'Records returned (1–500)' },
      mappingId: {
        type: 'string',
        description: 'The mapping being edited (uuid)',
      },
    }),
  })
  @ApiOkResponse({ type: SamplePreviewResponseDto })
  @ApiPayloadTooLargeResponse({ description: 'Larger than 20 MB' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Not CSV or XLSX' })
  @ApiUnprocessableEntityResponse({
    description: 'A PDF, or an unreadable workbook',
  })
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedSample | undefined,
    @Body() dto: SamplePreviewFormDto,
  ): Promise<SamplePreviewResponseDto> {
    let spec: unknown;
    try {
      spec = JSON.parse(dto.spec);
    } catch {
      throw new BadRequestException('spec: not JSON');
    }
    return SamplePreviewResponseDto.from(
      await this.mappings.previewSample(
        user.userId,
        sampleFromUpload(file, dto.name),
        spec,
        dto.limit ?? 50,
        dto.mappingId,
      ),
    );
  }
}
