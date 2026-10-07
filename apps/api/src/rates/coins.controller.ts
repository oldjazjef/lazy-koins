import {
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
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  ChooseProjectCoinCommand,
  type ChooseProjectCoinResult,
  type CoinChoiceResult,
  type CoinSearchView,
  DismissSharedTickerCommand,
  GetCoinQuery,
  SearchCoinsQuery,
  SetCoinChoiceCommand,
} from './application/coin-choice.handlers';
import type { CoinCandidate } from './domain/coin-choice';
import {
  ChooseCoinDto,
  ChooseCoinResponseDto,
  CoinCandidateDto,
  CoinRefDto,
  CoinSearchQueryDto,
  CoinChoiceResponseDto,
  CoinSearchResponseDto,
} from './dto/coins.dto';
import { CoinRefParamsDto } from './dto/coin-params.dto';

/** The coin directory is a public API with a small free limit: a budget per account. */
const DIRECTORY_BUDGET = { default: { limit: 30, ttl: 60_000 } };

/**
 * F7.4 "Coin wählen": search a provider's coins, check an id, store the coin per ticker
 * (Einstellungen › Kurse) or choose it from a project's Kurse tab (+ refetch). Thin: the logic
 * lives in `coin-choice.handlers.ts`.
 */
@ApiTags('rates')
@ApiBearerAuth(BEARER_SCHEME)
@Controller()
export class CoinsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get('rates/coins/search')
  @Throttle(DIRECTORY_BUDGET)
  @ApiOperation({
    summary:
      'Search coins by symbol, name or id at the price provider (online lookups on, F11.3)',
  })
  @ApiOkResponse({ type: CoinSearchResponseDto })
  @ApiConflictResponse({ description: '`offline`' })
  @ApiBadGatewayResponse({ description: '`coinProviderFailed`' })
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CoinSearchQueryDto,
  ): Promise<CoinSearchResponseDto> {
    const view: CoinSearchView = await this.queries.execute(
      new SearchCoinsQuery(user.userId, query.provider ?? 'coingecko', query.q),
    );
    return { ...view, coins: [...view.coins] };
  }

  @Get('rates/coins/:provider/:id')
  @Throttle(DIRECTORY_BUDGET)
  @ApiOperation({
    summary: 'Check a coin id at the provider: name, symbol, rank',
  })
  @ApiOkResponse({ type: CoinCandidateDto })
  @ApiUnprocessableEntityResponse({ description: '`unknownCoin`' })
  async coin(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: CoinRefParamsDto,
  ): Promise<CoinCandidateDto> {
    const coin: CoinCandidate = await this.queries.execute(
      new GetCoinQuery(user.userId, params.provider, params.id),
    );
    return { ...coin };
  }

  @Put('settings/coins/:symbol')
  @Throttle(DIRECTORY_BUDGET)
  @ApiOperation({
    summary:
      'Choose the coin of a ticker (validated at the provider); removes the asset’s fetched prices of open projects and the rate cache',
  })
  @ApiOkResponse({ type: CoinChoiceResponseDto })
  @ApiUnprocessableEntityResponse({ description: '`unknownCoin`' })
  async setChoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('symbol') symbol: string,
    @Body() dto: CoinRefDto,
  ): Promise<CoinChoiceResponseDto> {
    return toResponse(
      await this.commands.execute(
        new SetCoinChoiceCommand(user.userId, symbol, {
          provider: dto.provider,
          id: dto.id,
        }),
      ),
    );
  }

  @Delete('settings/coins/:symbol')
  @ApiOperation({
    summary: 'Remove the coin of a ticker (the ticker rules apply again)',
  })
  @ApiOkResponse({ type: CoinChoiceResponseDto })
  async removeChoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('symbol') symbol: string,
  ): Promise<CoinChoiceResponseDto> {
    return toResponse(
      await this.commands.execute(
        new SetCoinChoiceCommand(user.userId, symbol, null),
      ),
    );
  }

  @Put('settings/coins/:symbol/dismissal')
  @ApiOperation({
    summary:
      '"Passt so": no more shared-code warning for this ticker (not for the hand-kept ambiguous list)',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { dismissed: { type: 'array', items: { type: 'string' } } },
    },
  })
  async dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('symbol') symbol: string,
  ): Promise<{ dismissed: string[] }> {
    const answer: { dismissed: readonly string[] } =
      await this.commands.execute(
        new DismissSharedTickerCommand(user.userId, symbol, true),
      );
    return { dismissed: [...answer.dismissed] };
  }

  @Delete('settings/coins/:symbol/dismissal')
  @ApiOperation({ summary: 'Warn again about a shared ticker' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { dismissed: { type: 'array', items: { type: 'string' } } },
    },
  })
  async undismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('symbol') symbol: string,
  ): Promise<{ dismissed: string[] }> {
    const answer: { dismissed: readonly string[] } =
      await this.commands.execute(
        new DismissSharedTickerCommand(user.userId, symbol, false),
      );
    return { dismissed: [...answer.dismissed] };
  }

  @Post('projects/:projectId/rates/coin')
  @HttpCode(200)
  @Throttle(DIRECTORY_BUDGET)
  @ApiOperation({
    summary:
      '"Falscher Kurs? Coin wählen": store the coin of an asset and fetch its prices again (force) from that provider only',
  })
  @ApiOkResponse({ type: ChooseCoinResponseDto })
  @ApiConflictResponse({ description: '`offline` or `projectClosed`' })
  async choose(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ChooseCoinDto,
  ): Promise<ChooseCoinResponseDto> {
    const result: ChooseProjectCoinResult = await this.commands.execute(
      new ChooseProjectCoinCommand(user.userId, projectId, dto.asset, {
        provider: dto.provider,
        id: dto.id,
      }),
    );
    return { ...toResponse(result), fetch: { ...result.fetch } };
  }
}

function toResponse(result: CoinChoiceResult): CoinChoiceResponseDto {
  return {
    symbol: result.symbol,
    choice: result.choice ? { ...result.choice } : null,
    choices: Object.fromEntries(
      Object.entries(result.choices).map(([k, v]) => [k, { ...v }]),
    ),
    removed: { ...result.removed },
  };
}
