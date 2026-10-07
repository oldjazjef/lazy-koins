import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import type { Env } from '../config/env';
import { FilesModule } from '../files/files.module';
import {
  DeleteLibraryMappingHandler,
  PublishLibraryMappingHandler,
  RateLibraryMappingHandler,
  TakeLibraryMappingHandler,
} from './application/library.commands';
import {
  GetLibraryMappingHandler,
  ProjectLibraryMatchesHandler,
  ReviewPublicationHandler,
  SearchLibraryHandler,
} from './application/library.queries';
import { LibraryRuntime } from './application/library-runtime';
import {
  LibraryController,
  LibraryEnabledGuard,
  ProjectLibraryController,
} from './library.controller';
import { LibraryService } from './library.service';

/**
 * F5.15–F5.17: the global mapping library — web only. With `AUTH_MODE=local` (desktop) the
 * runtime is off: every route answers 404 and the tool layer registers no library tools.
 */
@Module({
  imports: [CqrsModule, FilesModule],
  controllers: [LibraryController, ProjectLibraryController],
  providers: [
    {
      provide: LibraryRuntime,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new LibraryRuntime(
          config.get('AUTH_MODE', { infer: true }) !== 'local',
        ),
    },
    LibraryEnabledGuard,
    LibraryService,
    SearchLibraryHandler,
    GetLibraryMappingHandler,
    ReviewPublicationHandler,
    ProjectLibraryMatchesHandler,
    PublishLibraryMappingHandler,
    DeleteLibraryMappingHandler,
    RateLibraryMappingHandler,
    TakeLibraryMappingHandler,
  ],
  // The tool layer (tools/) calls the same façade as the controller.
  exports: [LibraryService],
})
export class LibraryModule {}
