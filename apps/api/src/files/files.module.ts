import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { RawBodyMiddleware } from '../common/http/raw-body.middleware';
import { AddDerivedFileHandler } from './application/commands/add-derived-file.command';
import { ChangeProjectFileHandler } from './application/commands/change-project-file.command';
import { ReapplyMappingHandler } from './application/commands/reapply-mapping.command';
import { RemoveProjectFileHandler } from './application/commands/remove-project-file.command';
import { UploadProjectFileHandler } from './application/commands/upload-project-file.command';
import { FileAnalysisService } from './application/file-analysis.service';
import { FileViews } from './application/file-views';
import {
  GetFileContentHandler,
  PreviewFileHandler,
} from './application/queries/file-content.query';
import { ListProjectFilesHandler } from './application/queries/list-project-files.query';
import { PdfTextExtractor } from './application/pdf-text-extractor';
import { PreviewMappingHandler } from './application/queries/preview-mapping.query';
import { SourceFileReader } from './application/source-file-reader';
import { FilesController } from './files.controller';
import {
  ListProjectHintsHandler,
  UpdateHintStateHandler,
} from './application/queries/project-hints.query';
import { FileRowErrorsHandler } from './application/queries/row-errors.query';
import { FilesService } from './files.service';
import { HintsController } from './hints.controller';
import { StandardFormatController } from './standard-format.controller';

/**
 * Files of a project (F5): upload, overview, download, preview, removal, reading with the
 * standard format or a mapping spec. Storage ports are bound in the global `PersistenceModule`.
 */
@Module({
  imports: [CqrsModule],
  controllers: [FilesController, HintsController, StandardFormatController],
  providers: [
    FilesService,
    FileViews,
    FileAnalysisService,
    SourceFileReader,
    PdfTextExtractor,
    UploadProjectFileHandler,
    AddDerivedFileHandler,
    ChangeProjectFileHandler,
    RemoveProjectFileHandler,
    ReapplyMappingHandler,
    ListProjectFilesHandler,
    GetFileContentHandler,
    PreviewFileHandler,
    PreviewMappingHandler,
    ListProjectHintsHandler,
    UpdateHintStateHandler,
    FileRowErrorsHandler,
  ],
  exports: [
    FilesService,
    FileViews,
    FileAnalysisService,
    SourceFileReader,
    PdfTextExtractor,
  ],
})
export class FilesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Only the upload reads a raw body; everything else keeps the JSON parser.
    consumer.apply(RawBodyMiddleware).forRoutes({
      path: 'projects/:projectId/files',
      method: RequestMethod.POST,
    });
  }
}
