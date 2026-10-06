import { Global, Module } from '@nestjs/common';
import { ProjectFileRepositoryPort } from '../files/ports/project-file.repository.port';
import { ImportMappingRepositoryPort } from '../mappings/ports/import-mapping.repository.port';
import { ProjectRepositoryPort } from '../projects/ports/project.repository.port';
import { UserRepositoryPort } from '../users/ports/user.repository.port';
import { PrismaService } from './prisma/prisma.service';
import { ImportMappingPrismaRepository } from './prisma/repositories/import-mapping.prisma.repository';
import { ProjectFilePrismaRepository } from './prisma/repositories/project-file.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
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
  ],
  exports: [
    UserRepositoryPort,
    ProjectRepositoryPort,
    ProjectFileRepositoryPort,
    ImportMappingRepositoryPort,
  ],
})
export class PersistenceModule {}
