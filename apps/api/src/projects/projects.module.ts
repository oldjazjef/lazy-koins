import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CalculationModule } from '../calculation/calculation.module';
import { CreateProjectHandler } from './application/commands/create-project.command';
import { DeleteProjectHandler } from './application/commands/delete-project.command';
import { UpdateProjectHandler } from './application/commands/update-project.command';
import { GetProjectHandler } from './application/queries/get-project.query';
import { ListMyProjectsHandler } from './application/queries/list-my-projects.query';
import {
  GetProjectSentHandler,
  MarkProjectSentHandler,
  UndoProjectSentHandler,
} from './application/sent.handlers';
import { ProjectSentController } from './project-sent.controller';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/**
 * The reference feature slice — copy its shape. No storage here: `ProjectRepositoryPort` is
 * bound in the global `PersistenceModule`.
 */
@Module({
  // The list tells stale figures with the calculation's input hash (F7.6).
  imports: [CqrsModule, CalculationModule],
  controllers: [ProjectsController, ProjectSentController],
  providers: [
    ProjectsService,
    ListMyProjectsHandler,
    GetProjectHandler,
    CreateProjectHandler,
    UpdateProjectHandler,
    DeleteProjectHandler,
    GetProjectSentHandler,
    MarkProjectSentHandler,
    UndoProjectSentHandler,
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
