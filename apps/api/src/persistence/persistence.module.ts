import { Global, Module } from '@nestjs/common';
import { ProjectRepositoryPort } from '../projects/ports/project.repository.port';
import { UserRepositoryPort } from '../users/ports/user.repository.port';
import { PrismaService } from './prisma/prisma.service';
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
  ],
  exports: [UserRepositoryPort, ProjectRepositoryPort],
})
export class PersistenceModule {}
