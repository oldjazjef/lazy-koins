import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { FilesModule } from '../files/files.module';
import {
  CreateMappingHandler,
  DeleteMappingHandler,
  UpdateMappingHandler,
} from './application/commands/mapping.commands';
import {
  GetMappingHandler,
  GetMappingUsageHandler,
  ListMappingsHandler,
  ListProjectMappingsHandler,
} from './application/queries/mapping.queries';
import {
  InspectSampleHandler,
  PreviewSampleHandler,
} from './application/queries/mapping-sample.queries';
import { MappingSamplesController } from './mapping-samples.controller';
import {
  MappingsController,
  ProjectMappingsController,
} from './mappings.controller';
import { MappingsService } from './mappings.service';

/**
 * Mapping specs (owner-scoped): CRUD, JSON download, the JSON Schema, and the mappings a
 * project uses. Re-applying to files is the files module's (`FilesService.reapplyMapping`).
 */
@Module({
  imports: [CqrsModule, FilesModule],
  controllers: [
    MappingsController,
    ProjectMappingsController,
    MappingSamplesController,
  ],
  providers: [
    MappingsService,
    InspectSampleHandler,
    PreviewSampleHandler,
    ListMappingsHandler,
    GetMappingHandler,
    GetMappingUsageHandler,
    ListProjectMappingsHandler,
    CreateMappingHandler,
    UpdateMappingHandler,
    DeleteMappingHandler,
  ],
})
export class MappingsModule {}
