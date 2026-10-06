import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CalculationModule } from '../calculation/calculation.module';
import { SettingsModule } from '../settings/settings.module';
import {
  CreateExportHandler,
  ExportDataService,
  GetExportContentHandler,
  GetMailDraftHandler,
  ListExportsHandler,
} from './application/exports.handlers';
import { DataExportHandler } from './application/data-export.handlers';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/**
 * Statements (F10): simple and detailed, Excel (ExcelJS) and PDF (HTML printed by Chromium
 * through `PdfRendererPort`), stored per project; the mail draft to the Treuhänder.
 */
@Module({
  imports: [CqrsModule, CalculationModule, SettingsModule],
  controllers: [ExportsController],
  providers: [
    ExportsService,
    ExportDataService,
    CreateExportHandler,
    ListExportsHandler,
    GetExportContentHandler,
    GetMailDraftHandler,
    DataExportHandler,
  ],
})
export class ExportsModule {}
