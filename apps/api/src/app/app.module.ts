import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  AccountThrottlerGuard,
  IpThrottlerGuard,
  throttlerOptions,
} from '../common/throttling/throttling';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { validateEnv } from '../config/env';
import { CalculationModule } from '../calculation/calculation.module';
import { CarryoverModule } from '../carryover/carryover.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { PackagesModule } from '../packages/packages.module';
import { ExportsModule } from '../exports/exports.module';
import { FilesModule } from '../files/files.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MailModule } from '../mail/mail.module';
import { MappingsModule } from '../mappings/mappings.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { ProjectsModule } from '../projects/projects.module';
import { RatesModule } from '../rates/rates.module';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // First match wins: a local override, then the developer's .env. Both git-ignored.
      envFilePath: ['apps/api/.env.local', 'apps/api/.env', '.env'],
      // The desktop app (apps/desktop) sets every variable itself before it loads this module; a
      // stray .env in whatever directory it was started from must not leak in.
      ignoreEnvFile: process.env['LK_IGNORE_ENV_FILE'] === 'true',
    }),
    // Per-IP hygiene plus a per-account budget for writes (common/throttling).
    ThrottlerModule.forRootAsync({ useFactory: throttlerOptions }),
    // Global: every repository port → its Prisma adapter.
    PersistenceModule,
    // Global: identity-token verifier → its adapter (chosen by AUTH_MODE).
    IntegrationsModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    FilesModule,
    MappingsModule,
    SettingsModule,
    CalculationModule,
    RatesModule,
    ExportsModule,
    AiModule,
    WalletsModule,
    MailModule,
    DashboardModule,
    CarryoverModule,
    PackagesModule,
  ],
  controllers: [AppController],
  providers: [
    // Global guards run in registration order: the per-IP limit first (cheap, and it must also
    // cover requests with bad tokens), then authentication, then the per-account limits (they key
    // on the user the token named). All bound here so the order lives in one place.
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: AccountThrottlerGuard },
  ],
})
export class AppModule {}
