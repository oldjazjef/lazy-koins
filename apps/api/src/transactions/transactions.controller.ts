import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_SCHEME } from '../openapi/security-schemes';
import {
  DecideSuggestionsDto,
  EditResultDto,
  EditTransactionsDto,
  KindRuleDto,
  SuggestTransactionsDto,
  TransactionDetailDto,
  TransactionKeyQueryDto,
  TransactionKeysDto,
  TransactionsPageDto,
  TransactionsQueryDto,
} from './dto/transaction.dto';
import { TransactionsService } from './transactions.service';

/** AI requests are expensive: 20 per account in 10 minutes. */
const AI_BUDGET = { writes: { limit: 20, ttl: 10 * 60_000 } };

/** F9.5–F9.10: every transaction of mine, global edits, AI suggestions. */
@ApiTags('transactions')
@ApiBearerAuth(BEARER_SCHEME)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Every transaction of mine (all files and wallets), filtered and paged (F9.5)',
  })
  @ApiOkResponse({ type: TransactionsPageDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TransactionsQueryDto,
  ): Promise<TransactionsPageDto> {
    return (await this.transactions.list(
      user.userId,
      query,
    )) as unknown as TransactionsPageDto;
  }

  @Get('detail')
  @ApiOperation({
    summary: 'One transaction: original row and history of edits (F9.5)',
  })
  @ApiOkResponse({ type: TransactionDetailDto })
  @ApiNotFoundResponse({ description: 'No such transaction of mine' })
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TransactionKeyQueryDto,
  ): Promise<TransactionDetailDto> {
    return (await this.transactions.detail(
      user.userId,
      query.key,
    )) as unknown as TransactionDetailDto;
  }

  @Post('edits')
  @ApiOperation({
    summary:
      'Change transactions globally — kind, asset, note, hide, link — with a reason (F9.8)',
  })
  @ApiOkResponse({ type: EditResultDto })
  @ApiConflictResponse({
    description: 'transactionLocked: a closed project uses one (F9.9)',
  })
  @HttpCode(200)
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: EditTransactionsDto,
  ): Promise<EditResultDto> {
    return this.transactions.edit(
      user.userId,
      body.keys,
      body.changes,
      body.reason,
    ) as Promise<EditResultDto>;
  }

  @Post('edits/:editId/undo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Undo a global edit (F9.4)' })
  undo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('editId') editId: string,
  ) {
    return this.transactions.setUndone(user.userId, editId, true);
  }

  @Post('edits/:editId/redo')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Redo an undone (or superseded, F9.11) global edit',
  })
  redo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('editId') editId: string,
  ) {
    return this.transactions.setUndone(user.userId, editId, false);
  }

  @Post('ai/payload')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exactly what "Mit AI analysieren" would send (F9.10, F5.14)',
  })
  aiPayload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TransactionKeysDto,
  ) {
    return this.transactions.aiPayload(user.userId, body.keys ?? []);
  }

  @Post('ai/suggest')
  @Throttle(AI_BUDGET)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'The AI suggests a kind per transaction — stored as suggestions, nothing changes (F9.10)',
  })
  suggest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SuggestTransactionsDto,
  ) {
    return this.transactions.suggest(
      user.userId,
      body.keys ?? [],
      body.consent === true,
    );
  }

  @Post('suggestions/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm AI suggestions → global edits (F9.10)' })
  @ApiOkResponse({ type: EditResultDto })
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DecideSuggestionsDto,
  ): Promise<EditResultDto> {
    return this.transactions.decide(
      user.userId,
      body.ids,
      true,
      body.reason,
    ) as Promise<EditResultDto>;
  }

  @Post('suggestions/dismiss')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dismiss AI suggestions (F9.10)' })
  dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DecideSuggestionsDto,
  ) {
    return this.transactions.decide(user.userId, body.ids, false);
  }

  @Post('mapping-rule')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "The transaction's platform type → kind as the first rule of its mapping (F9.10)",
  })
  kindRule(@CurrentUser() user: AuthenticatedUser, @Body() body: KindRuleDto) {
    return this.transactions.kindRule(user.userId, body.key, body.kind);
  }
}
