import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CreateProjectHandler } from './application/commands/create-project.command';
import { DeleteProjectHandler } from './application/commands/delete-project.command';
import { UpdateProjectHandler } from './application/commands/update-project.command';
import { GetProjectHandler } from './application/queries/get-project.query';
import { ListMyProjectsHandler } from './application/queries/list-my-projects.query';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/**
 * The reference feature slice — copy its shape. No storage here: `ProjectRepositoryPort` is
 * bound in the global `PersistenceModule`.
 */
@Module({
  imports: [CqrsModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ListMyProjectsHandler,
    GetProjectHandler,
    CreateProjectHandler,
    UpdateProjectHandler,
    DeleteProjectHandler,
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
