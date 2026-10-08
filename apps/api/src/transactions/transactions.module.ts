import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AiModule } from '../ai/ai.module';
import { CalculationModule } from '../calculation/calculation.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { TransactionLedgerService } from './application/transaction-ledger.service';
import {
  AddKindRuleHandler,
  DecideSuggestionsHandler,
  EditTransactionsHandler,
  GetTransactionHandler,
  ListUserTransactionsHandler,
  SetTransactionEditUndoneHandler,
  SuggestTransactionsHandler,
  TransactionAiPayloadHandler,
} from './application/transactions.handlers';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/**
 * F9.5–F9.12: every transaction of the user and the global edits ("one truth per
 * transaction"). The edits port is bound in PersistenceModule; the calculation and the
 * dashboard read the edits themselves.
 */
@Module({
  imports: [CqrsModule, CalculationModule, DashboardModule, AiModule],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    TransactionLedgerService,
    ListUserTransactionsHandler,
    GetTransactionHandler,
    EditTransactionsHandler,
    SetTransactionEditUndoneHandler,
    TransactionAiPayloadHandler,
    SuggestTransactionsHandler,
    DecideSuggestionsHandler,
    AddKindRuleHandler,
  ],
  exports: [TransactionsService, TransactionLedgerService],
})
export class TransactionsModule {}
