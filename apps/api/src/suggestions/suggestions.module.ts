import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { FilesModule } from '../files/files.module';
import { LibraryModule } from '../library/library.module';
import {
  GetStandardMappingHandler,
  ListStandardMappingsHandler,
  ProjectMappingSuggestionsHandler,
  SuggestionPreviewHandler,
  TakeStandardMappingHandler,
} from './application/suggestions.handlers';
import {
  MappingSuggestionsController,
  StandardMappingsController,
} from './suggestions.controller';
import { SuggestionsService } from './suggestions.service';

/**
 * F5.19: mapping suggestions for files that need one, and the bundled standard mappings
 * (`mappings/standard/`) as read-only templates — on the web and the desktop alike. The library
 * part goes through `LibraryService` (web: own library; desktop: a linked server, F5.18).
 */
@Module({
  imports: [CqrsModule, FilesModule, LibraryModule],
  controllers: [StandardMappingsController, MappingSuggestionsController],
  providers: [
    SuggestionsService,
    ListStandardMappingsHandler,
    GetStandardMappingHandler,
    TakeStandardMappingHandler,
    ProjectMappingSuggestionsHandler,
    SuggestionPreviewHandler,
  ],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
