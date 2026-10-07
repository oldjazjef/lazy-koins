import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  type EstvStatusView,
  GetEstvStatusQuery,
  StartEstvUpdateCommand,
} from './application/estv.handlers';
import { EstvStatusResponseDto, EstvUpdateDto } from './dto/rates.dto';

/** Starting a download is cheap to ask for but heavy to run: a few per account and hour. */
const UPDATE_BUDGET = { writes: { limit: 10, ttl: 60 * 60_000 } };

/**
 * The ESTV Kursliste of the deployment (F7.4a) — not per user, so not under a project. Thin:
 * the logic lives in the handlers.
 */
@ApiTags('rates')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('rates/estv')
export class EstvController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'ESTV Kursliste (F7.4a): stored version per tax year, last check and errors, a running update',
  })
  @ApiOkResponse({ type: EstvStatusResponseDto })
  async status(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EstvStatusResponseDto> {
    const view: EstvStatusView = await this.queries.execute(
      new GetEstvStatusQuery(user.userId),
    );
    return view as unknown as EstvStatusResponseDto;
  }

  @Post('update')
  @HttpCode(202)
  @Throttle(UPDATE_BUDGET)
  @ApiOperation({
    summary:
      '"ESTV-Kursliste aktualisieren": checks ICTax and downloads a newer list in the background; poll GET',
  })
  @ApiOkResponse({ type: EstvStatusResponseDto })
  @ApiBadRequestResponse({ description: 'Year out of range' })
  @ApiConflictResponse({
    description:
      'ESTV_AUTO=false, RATES_ONLINE=false or the user switched rate lookups off (F11.3)',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EstvUpdateDto,
  ): Promise<EstvStatusResponseDto> {
    const view: EstvStatusView = await this.commands.execute(
      new StartEstvUpdateCommand(user.userId, dto.year),
    );
    return view as unknown as EstvStatusResponseDto;
  }
}
