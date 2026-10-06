import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { SecretBox } from '../common/crypto/secret-box';
import { aiPrivateUrlsAllowed, type Env } from '../config/env';
import { FilesModule } from '../files/files.module';
import { SettingsModule } from '../settings/settings.module';
import { ChainGate, ChainRuntime } from './application/chain-gate';
import {
  GetChainSettingsHandler,
  SaveChainSettingsHandler,
  TestChainServiceHandler,
} from './application/chain-settings.handlers';
import {
  AddManualBalanceHandler,
  AddProjectWalletHandler,
  ListProjectWalletsHandler,
  RemoveManualBalanceHandler,
  RemoveProjectWalletHandler,
} from './application/project-wallets.handlers';
import { WalletDerivedFiles } from './application/wallet-derived-files';
import { WalletViews } from './application/wallet-views';
import {
  CheckNetworksHandler,
  CreateWalletHandler,
  DeleteWalletHandler,
  FetchWalletHandler,
  GetWalletHandler,
  ListWalletsHandler,
  ListWalletTokensHandler,
  SetTokenOverrideHandler,
  UpdateWalletHandler,
} from './application/wallets.handlers';
import {
  ProjectWalletsController,
  WalletSettingsController,
  WalletsController,
} from './wallets.controller';
import { WalletsService } from './wallets.service';

/**
 * Wallets (F6.1–F6.7): wallets per user, the network check, fetching through the chain adapters
 * (`ChainDataSourcesPort`, bound in `IntegrationsModule`), derived standard-format files in the
 * projects, manual balances with receipts, spam overrides, and the keys/URLs in the settings.
 * Repository ports are bound in the global `PersistenceModule`.
 */
@Module({
  imports: [CqrsModule, SettingsModule, FilesModule],
  controllers: [
    WalletsController,
    ProjectWalletsController,
    WalletSettingsController,
  ],
  providers: [
    WalletsService,
    WalletViews,
    WalletDerivedFiles,
    ChainGate,
    {
      provide: ChainRuntime,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new ChainRuntime(
          new SecretBox(
            config.get('SETTINGS_ENCRYPTION_KEY', { infer: true }) ?? '',
          ),
          config.get('RATES_ONLINE', { infer: true }) !== 'false',
          aiPrivateUrlsAllowed({
            AI_ALLOW_PRIVATE_URLS: config.get('AI_ALLOW_PRIVATE_URLS', {
              infer: true,
            }),
            AUTH_MODE: config.get('AUTH_MODE', { infer: true }),
          }),
        ),
    },
    ListWalletsHandler,
    GetWalletHandler,
    CreateWalletHandler,
    UpdateWalletHandler,
    DeleteWalletHandler,
    CheckNetworksHandler,
    FetchWalletHandler,
    ListWalletTokensHandler,
    SetTokenOverrideHandler,
    ListProjectWalletsHandler,
    AddProjectWalletHandler,
    RemoveProjectWalletHandler,
    AddManualBalanceHandler,
    RemoveManualBalanceHandler,
    GetChainSettingsHandler,
    SaveChainSettingsHandler,
    TestChainServiceHandler,
  ],
  // F4.4a: the follow-up project links wallets and lets them write their derived files.
  exports: [WalletDerivedFiles],
})
export class WalletsModule {}
