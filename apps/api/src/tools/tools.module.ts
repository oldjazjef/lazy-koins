import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiGate } from '../ai/application/ai-gate';
import { CalculationModule } from '../calculation/calculation.module';
import { CalculationService } from '../calculation/calculation.service';
import { ExportsModule } from '../exports/exports.module';
import { ExportsService } from '../exports/exports.service';
import { FilesModule } from '../files/files.module';
import { FilesService } from '../files/files.service';
import { LibraryModule } from '../library/library.module';
import { LibraryService } from '../library/library.service';
import { MailModule } from '../mail/mail.module';
import { MailService } from '../mail/mail.service';
import { MappingsModule } from '../mappings/mappings.module';
import { MappingsService } from '../mappings/mappings.service';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectsService } from '../projects/projects.service';
import { RatesModule } from '../rates/rates.module';
import { RatesService } from '../rates/rates.service';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';
import { WalletsModule } from '../wallets/wallets.module';
import { WalletsService } from '../wallets/wallets.service';
import { ToolExecutor } from './application/tool-executor';
import { ToolRegistry } from './application/tool-registry';

/**
 * The one tool layer (F11.14, F11.16): typed tools over the feature services, shared by the chat
 * (assistant/) and the MCP server (mcp/). Every call is audited (`tool_audit`).
 */
@Module({
  imports: [
    ProjectsModule,
    FilesModule,
    MappingsModule,
    LibraryModule,
    CalculationModule,
    RatesModule,
    ExportsModule,
    WalletsModule,
    SettingsModule,
    MailModule,
    AiModule,
  ],
  providers: [
    {
      provide: ToolRegistry,
      inject: [
        ProjectsService,
        FilesService,
        MappingsService,
        CalculationService,
        RatesService,
        ExportsService,
        WalletsService,
        SettingsService,
        MailService,
        AiGate,
        LibraryService,
      ],
      useFactory: (
        projects: ProjectsService,
        files: FilesService,
        mappings: MappingsService,
        calculation: CalculationService,
        rates: RatesService,
        exports: ExportsService,
        wallets: WalletsService,
        settings: SettingsService,
        mail: MailService,
        ai: AiGate,
        library: LibraryService,
      ) =>
        ToolRegistry.over({
          projects,
          files,
          mappings,
          calculation,
          rates,
          exports,
          wallets,
          settings,
          mail,
          ai,
          library,
        }),
    },
    ToolExecutor,
  ],
  exports: [ToolRegistry, ToolExecutor],
})
export class ToolsModule {}
