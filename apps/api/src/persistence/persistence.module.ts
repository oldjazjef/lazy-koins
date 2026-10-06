import { Global, Module } from '@nestjs/common';
import {
  CalculationSnapshotRepositoryPort,
  CorrectionRepositoryPort,
  OpenItemStateRepositoryPort,
} from '../calculation/ports/calculation.repository.port';
import { ProjectExportRepositoryPort } from '../exports/ports/project-export.repository.port';
import { AiSettingsRepositoryPort } from '../ai/ports/ai-settings.repository.port';
import { ProjectFileRepositoryPort } from '../files/ports/project-file.repository.port';
import { ImportMappingRepositoryPort } from '../mappings/ports/import-mapping.repository.port';
import { ProjectRepositoryPort } from '../projects/ports/project.repository.port';
import { ProjectRateRepositoryPort } from '../rates/ports/project-rate.repository.port';
import { UserSettingsRepositoryPort } from '../settings/ports/user-settings.repository.port';
import { UserRepositoryPort } from '../users/ports/user.repository.port';
import { PrismaService } from './prisma/prisma.service';
import {
  CalculationSnapshotPrismaRepository,
  CorrectionPrismaRepository,
  OpenItemStatePrismaRepository,
} from './prisma/repositories/calculation.prisma.repository';
import { AiSettingsPrismaRepository } from './prisma/repositories/ai-settings.prisma.repository';
import { ImportMappingPrismaRepository } from './prisma/repositories/import-mapping.prisma.repository';
import { ProjectExportPrismaRepository } from './prisma/repositories/project-export.prisma.repository';
import { ProjectFilePrismaRepository } from './prisma/repositories/project-file.prisma.repository';
import { ProjectRatePrismaRepository } from './prisma/repositories/project-rate.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserSettingsPrismaRepository } from './prisma/repositories/user-settings.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

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
  ],
  exports: [
    UserRepositoryPort,
    ProjectRepositoryPort,
    ProjectFileRepositoryPort,
    ImportMappingRepositoryPort,
    UserSettingsRepositoryPort,
    ProjectRateRepositoryPort,
    CalculationSnapshotRepositoryPort,
    CorrectionRepositoryPort,
    OpenItemStateRepositoryPort,
    ProjectExportRepositoryPort,
    AiSettingsRepositoryPort,
  ],
})
export class PersistenceModule {}
