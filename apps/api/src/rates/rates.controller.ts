import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { decodeText } from '@lazykoins/engine';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  DeleteRateQueryDto,
  ManualRateDto,
  RatesQueryDto,
  RatesResponseDto,
  RefreshRatesDto,
  RefreshResponseDto,
  RefreshStatusResponseDto,
} from './dto/rates.dto';
import { RatesService } from './rates.service';

/** A refresh fans out to external APIs: a few per account and 10 minutes are plenty. */
const REFRESH_BUDGET = { writes: { limit: 10, ttl: 10 * 60_000 } };

@ApiTags('rates')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('projects/:projectId/rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Stored rates (F7.4): series overview; with ?asset= every point of one asset',
  })
  @ApiOkResponse({ type: RatesResponseDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: RatesQueryDto,
  ): Promise<RatesResponseDto | Record<string, unknown>[]> {
    return (await this.rates.list(
      user.userId,
      projectId,
      query.asset,
    )) as unknown as RatesResponseDto;
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle(REFRESH_BUDGET)
  @ApiOperation({
    summary:
      '"Kurse aktualisieren": ECB exchange rates, Binance closes, CoinGecko (key) — stored per project',
  })
  @ApiOkResponse({ type: RefreshResponseDto })
  @ApiConflictResponse({
    description: 'Rate lookups are off (F11.3), or the project is closed',
  })
  async refresh(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: RefreshRatesDto,
  ): Promise<RefreshResponseDto> {
    return (await this.rates.refresh(
      user.userId,
      projectId,
      dto.force ?? false,
    )) as unknown as RefreshResponseDto;
  }

  @Get('refresh/status')
  @ApiOperation({
    summary:
      'Progress of a running "Kurse aktualisieren" (the app polls it only while its request runs)',
  })
  @ApiOkResponse({ type: RefreshStatusResponseDto })
  async refreshStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<RefreshStatusResponseDto> {
    return { ...(await this.rates.refreshStatus(user.userId, projectId)) };
  }

  @Put('manual')
  @ApiOperation({ summary: 'Override a rate for one day (F7.4)' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiConflictResponse({ description: 'The project is closed (F4.5)' })
  async setManual(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ManualRateDto,
  ): Promise<Record<string, string>> {
    return { ...(await this.rates.setManual(user.userId, projectId, dto)) };
  }

  @Delete('manual')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an override or an ESTV value' })
  @ApiNoContentResponse()
  async deleteManual(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: DeleteRateQueryDto,
  ): Promise<void> {
    await this.rates.deleteManual(user.userId, projectId, query);
  }

  @Post('estv')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Import the ESTV Kursliste (XML from ictax.admin.ch, or CSV asset;kurs_chf;datum) — the file as raw body',
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { imported: { type: 'number' }, skipped: { type: 'number' } },
    },
  })
  @ApiBadRequestResponse({ description: 'No rate found' })
  async importKursliste(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: Request,
  ): Promise<{ imported: number; skipped: number }> {
    const body: unknown = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException(
        'Send the Kursliste as the raw request body',
      );
    }
    const { text } = decodeText(new Uint8Array(body));
    return this.rates.importKursliste(user.userId, projectId, text);
  }
}
