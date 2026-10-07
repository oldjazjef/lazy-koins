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
  PublicLibraryEntryHandler,
  PublicLibraryMatchHandler,
  PublicLibraryPageHandler,
} from './application/public-library.handlers';
import { RemoteLibraryGate } from './application/remote-library-gate';
import {
  GetRemoteLibraryMappingHandler,
  GetRemoteLibrarySettingsHandler,
  LibraryStatusHandler,
  RemoteProjectLibraryMatchesHandler,
  SaveRemoteLibrarySettingsHandler,
  SearchRemoteLibraryHandler,
  TakeRemoteLibraryMappingHandler,
  TestRemoteLibraryHandler,
} from './application/remote-library.handlers';
import {
  LibraryController,
  LibraryEnabledGuard,
  LibrarySettingsController,
  ProjectLibraryController,
} from './library.controller';
import { LibraryService } from './library.service';
import {
  PublicLibraryController,
  PublicLibraryEnabledGuard,
  PublicLibraryService,
} from './public-library.controller';

/**
 * F5.15–F5.17: the global mapping library. On the web (`AUTH_MODE=firebase|dev`) the
 * deployment's own library, plus (F5.18) its public read-only endpoint for desktop apps
 * (`LIBRARY_PUBLIC`). On the desktop (`AUTH_MODE=local`) the `remote` mode: search, show and take
 * from a linked web deployment (Einstellungen › Bibliothek); publishing, reviews, ratings and
 * deletions answer 404 and their tools are not registered.
 */
@Module({
  imports: [CqrsModule, FilesModule],
  controllers: [
    LibraryController,
    ProjectLibraryController,
    LibrarySettingsController,
    PublicLibraryController,
  ],
  providers: [
    {
      provide: LibraryRuntime,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new LibraryRuntime(
          config.get('AUTH_MODE', { infer: true }) !== 'local',
          () => new Date(),
          {
            publicEndpoint:
              config.get('LIBRARY_PUBLIC', { infer: true }) !== 'false',
            online: config.get('RATES_ONLINE', { infer: true }) !== 'false',
          },
        ),
    },
    LibraryEnabledGuard,
    PublicLibraryEnabledGuard,
    LibraryService,
    PublicLibraryService,
    RemoteLibraryGate,
    SearchLibraryHandler,
    GetLibraryMappingHandler,
    ReviewPublicationHandler,
    ProjectLibraryMatchesHandler,
    PublishLibraryMappingHandler,
    DeleteLibraryMappingHandler,
    RateLibraryMappingHandler,
    TakeLibraryMappingHandler,
    PublicLibraryPageHandler,
    PublicLibraryEntryHandler,
    PublicLibraryMatchHandler,
    LibraryStatusHandler,
    SearchRemoteLibraryHandler,
    GetRemoteLibraryMappingHandler,
    RemoteProjectLibraryMatchesHandler,
    TakeRemoteLibraryMappingHandler,
    GetRemoteLibrarySettingsHandler,
    SaveRemoteLibrarySettingsHandler,
    TestRemoteLibraryHandler,
  ],
  // The tool layer (tools/) calls the same façade as the controller.
  exports: [LibraryService],
})
export class LibraryModule {}
