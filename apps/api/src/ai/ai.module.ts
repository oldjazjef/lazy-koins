import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { SecretBox } from '../common/crypto/secret-box';
import { aiPrivateUrlsAllowed, type Env } from '../config/env';
import { FilesModule } from '../files/files.module';
import {
  AiFilesController,
  AiSampleController,
  AiSettingsController,
} from './ai.controller';
import { AiService } from './ai.service';
import { AiGate, AiRuntime } from './application/ai-gate';
import { AiSources } from './application/ai-sources';
import {
  AcceptAiMappingHandler,
  AcceptSampleMappingHandler,
  GenerateMappingHandler,
  GenerateSampleMappingHandler,
  GetMappingPayloadHandler,
  GetSampleMappingPayloadHandler,
} from './application/mapping.handlers';
import {
  GetAiSettingsHandler,
  SaveAiSettingsHandler,
  TestAiConnectionHandler,
} from './application/settings.handlers';
import {
  AcceptStatementHandler,
  ExtractStatementHandler,
  GetStatementPayloadHandler,
} from './application/statement.handlers';

/**
 * The AI plugin (F5.13, F5.14): per-user settings, mappings written by an AI for files without
 * one, and PDF statements read into standard-format balances. The model is reached only through
 * `AiCompletionPort` (bound in `IntegrationsModule`); the settings live in `ai_settings`.
 */
@Module({
  imports: [CqrsModule, FilesModule],
  controllers: [AiSettingsController, AiFilesController, AiSampleController],
  providers: [
    AiService,
    AiGate,
    AiSources,
    {
      provide: AiRuntime,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new AiRuntime(
          new SecretBox(config.get('SETTINGS_ENCRYPTION_KEY', { infer: true })),
          aiPrivateUrlsAllowed({
            AI_ALLOW_PRIVATE_URLS: config.get('AI_ALLOW_PRIVATE_URLS', {
              infer: true,
            }),
            AUTH_MODE: config.get('AUTH_MODE', { infer: true }),
          }),
        ),
    },
    GetAiSettingsHandler,
    SaveAiSettingsHandler,
    TestAiConnectionHandler,
    GetMappingPayloadHandler,
    GenerateMappingHandler,
    AcceptAiMappingHandler,
    GetSampleMappingPayloadHandler,
    GenerateSampleMappingHandler,
    AcceptSampleMappingHandler,
    GetStatementPayloadHandler,
    ExtractStatementHandler,
    AcceptStatementHandler,
  ],
})
export class AiModule {}
