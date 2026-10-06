import { Global, Module } from '@nestjs/common';
import {
  CalculationSnapshotRepositoryPort,
  CorrectionRepositoryPort,
  OpenItemStateRepositoryPort,
} from '../calculation/ports/calculation.repository.port';
import { ProjectExportRepositoryPort } from '../exports/ports/project-export.repository.port';
import { AiSettingsRepositoryPort } from '../ai/ports/ai-settings.repository.port';
import { HintStateRepositoryPort } from '../files/ports/hint-state.repository.port';
import { ProjectFileRepositoryPort } from '../files/ports/project-file.repository.port';
import { ImportMappingRepositoryPort } from '../mappings/ports/import-mapping.repository.port';
import {
  MailLogRepositoryPort,
  MailSettingsRepositoryPort,
  MailTemplateRepositoryPort,
} from '../mail/ports/mail.repository.port';
import { ProjectRepositoryPort } from '../projects/ports/project.repository.port';
import { ProjectSentRepositoryPort } from '../projects/ports/project-sent.repository.port';
import { EstvKurslisteRepositoryPort } from '../rates/ports/estv.port';
import { ProjectRateRepositoryPort } from '../rates/ports/project-rate.repository.port';
import { UserSettingsRepositoryPort } from '../settings/ports/user-settings.repository.port';
import { UserRepositoryPort } from '../users/ports/user.repository.port';
import {
  ChainSettingsRepositoryPort,
  WalletRepositoryPort,
} from '../wallets/ports/wallet.repository.port';
import {
  CarryoverRepositoryPort,
  ProjectBundleRepositoryPort,
} from '../carryover/ports/carryover.repository.port';
import { UserRateRepositoryPort } from '../dashboard/ports/user-rate.repository.port';
import {
  AssistantSettingsRepositoryPort,
  ChatRepositoryPort,
} from '../assistant/ports/assistant.repository.port';
import { McpTokenRepositoryPort } from '../mcp/ports/mcp-token.repository.port';
import { ToolAuditRepositoryPort } from '../tools/ports/tool-audit.repository.port';
import { PrismaService } from './prisma/prisma.service';
import {
  AssistantSettingsPrismaRepository,
  ChatPrismaRepository,
  McpTokenPrismaRepository,
  ToolAuditPrismaRepository,
} from './prisma/repositories/assistant.prisma.repository';
import {
  CarryoverPrismaRepository,
  ProjectBundlePrismaRepository,
  UserRatePrismaRepository,
} from './prisma/repositories/carryover.prisma.repository';
import {
  CalculationSnapshotPrismaRepository,
  CorrectionPrismaRepository,
  OpenItemStatePrismaRepository,
} from './prisma/repositories/calculation.prisma.repository';
import { AiSettingsPrismaRepository } from './prisma/repositories/ai-settings.prisma.repository';
import { HintStatePrismaRepository } from './prisma/repositories/hint-state.prisma.repository';
import { ImportMappingPrismaRepository } from './prisma/repositories/import-mapping.prisma.repository';
import {
  MailLogPrismaRepository,
  MailSettingsPrismaRepository,
  MailTemplatePrismaRepository,
} from './prisma/repositories/mail.prisma.repository';
import { ProjectExportPrismaRepository } from './prisma/repositories/project-export.prisma.repository';
import { ProjectSentPrismaRepository } from './prisma/repositories/project-sent.prisma.repository';
import { ProjectFilePrismaRepository } from './prisma/repositories/project-file.prisma.repository';
import { EstvKurslistePrismaRepository } from './prisma/repositories/estv-kursliste.prisma.repository';
import { ProjectRatePrismaRepository } from './prisma/repositories/project-rate.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserSettingsPrismaRepository } from './prisma/repositories/user-settings.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';
import {
  ChainSettingsPrismaRepository,
  WalletPrismaRepository,
} from './prisma/repositories/wallet.prisma.repository';

/**
 * The only persistence layer, and the swap seam: every repository port is bound to its adapter
 * here, so feature modules name the port they need and never an adapter. Global, so no feature
 * module has to import it.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    { provide: UserRepositoryPort, useClass: UserPrismaRepository },
    { provide: ProjectRepositoryPort, useClass: ProjectPrismaRepository },
    {
      provide: ProjectFileRepositoryPort,
      useClass: ProjectFilePrismaRepository,
    },
    {
      provide: ImportMappingRepositoryPort,
      useClass: ImportMappingPrismaRepository,
    },
    {
      provide: UserSettingsRepositoryPort,
      useClass: UserSettingsPrismaRepository,
    },
    {
      provide: ProjectRateRepositoryPort,
      useClass: ProjectRatePrismaRepository,
    },
    {
      provide: EstvKurslisteRepositoryPort,
      useClass: EstvKurslistePrismaRepository,
    },
    {
      provide: CalculationSnapshotRepositoryPort,
      useClass: CalculationSnapshotPrismaRepository,
    },
    { provide: CorrectionRepositoryPort, useClass: CorrectionPrismaRepository },
    {
      provide: OpenItemStateRepositoryPort,
      useClass: OpenItemStatePrismaRepository,
    },
    {
      provide: ProjectExportRepositoryPort,
      useClass: ProjectExportPrismaRepository,
    },
    { provide: AiSettingsRepositoryPort, useClass: AiSettingsPrismaRepository },
    { provide: WalletRepositoryPort, useClass: WalletPrismaRepository },
    {
      provide: ChainSettingsRepositoryPort,
      useClass: ChainSettingsPrismaRepository,
    },
    { provide: HintStateRepositoryPort, useClass: HintStatePrismaRepository },
    {
      provide: MailSettingsRepositoryPort,
      useClass: MailSettingsPrismaRepository,
    },
    {
      provide: MailTemplateRepositoryPort,
      useClass: MailTemplatePrismaRepository,
    },
    { provide: MailLogRepositoryPort, useClass: MailLogPrismaRepository },
    {
      provide: ProjectSentRepositoryPort,
      useClass: ProjectSentPrismaRepository,
    },
    { provide: CarryoverRepositoryPort, useClass: CarryoverPrismaRepository },
    {
      provide: ProjectBundleRepositoryPort,
      useClass: ProjectBundlePrismaRepository,
    },
    { provide: UserRateRepositoryPort, useClass: UserRatePrismaRepository },
    {
      provide: AssistantSettingsRepositoryPort,
      useClass: AssistantSettingsPrismaRepository,
    },
    { provide: ChatRepositoryPort, useClass: ChatPrismaRepository },
    { provide: McpTokenRepositoryPort, useClass: McpTokenPrismaRepository },
    { provide: ToolAuditRepositoryPort, useClass: ToolAuditPrismaRepository },
  ],
  exports: [
    UserRepositoryPort,
    ProjectRepositoryPort,
    ProjectFileRepositoryPort,
    ImportMappingRepositoryPort,
    UserSettingsRepositoryPort,
    ProjectRateRepositoryPort,
    EstvKurslisteRepositoryPort,
    CalculationSnapshotRepositoryPort,
    CorrectionRepositoryPort,
    OpenItemStateRepositoryPort,
    ProjectExportRepositoryPort,
    AiSettingsRepositoryPort,
    WalletRepositoryPort,
    ChainSettingsRepositoryPort,
    HintStateRepositoryPort,
    MailSettingsRepositoryPort,
    MailTemplateRepositoryPort,
    MailLogRepositoryPort,
    ProjectSentRepositoryPort,
    CarryoverRepositoryPort,
    ProjectBundleRepositoryPort,
    UserRateRepositoryPort,
    AssistantSettingsRepositoryPort,
    ChatRepositoryPort,
    McpTokenRepositoryPort,
    ToolAuditRepositoryPort,
  ],
})
export class PersistenceModule {}
