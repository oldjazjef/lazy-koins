import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { MappingSample } from '@lazykoins/engine';
import { readableOf } from '../../files/application/file-access';
import {
  PdfTextExtractor,
  UnreadablePdfError,
} from '../../files/application/pdf-text-extractor';
import {
  type ReadableFile,
  SourceFileReader,
} from '../../files/application/source-file-reader';
import type { ProjectFile } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import { readSampleTable } from '../../mappings/application/sample-file';
import {
  buildStatementPayload,
  type StatementPayload,
} from '../domain/statement-extraction';

/**
 * What the AI gets to see of a file — built the same way for the preview the user confirms and
 * for the request itself, so both are the same object (F5.14).
 */
@Injectable()
export class AiSources {
  constructor(
    private readonly files: ProjectFileRepositoryPort,
    private readonly reader: SourceFileReader,
    private readonly pdf: PdfTextExtractor,
  ) {}

  async mappingSample(
    file: ProjectFile,
  ): Promise<{ sample: MappingSample; readable: ReadableFile }> {
    if (file.kind === 'pdf') {
      throw new UnprocessableEntityException(
        'A mapping reads tables (CSV, XLSX), not PDFs',
      );
    }
    const { readable } = await readableOf(this.files, file);
    return { sample: await this.sampleOf(readable), readable };
  }

  /** The sample of bytes that are not a project file (the mapping editor's sample file). */
  async sampleOf(readable: ReadableFile): Promise<MappingSample> {
    return (await readSampleTable(this.reader, readable)).sample;
  }

  async statement(
    file: ProjectFile,
  ): Promise<{ payload: StatementPayload; pages: string[] }> {
    if (file.kind !== 'pdf') {
      throw new UnprocessableEntityException(
        'Only PDF statements are read this way',
      );
    }
    const { readable } = await readableOf(this.files, file);
    let pages: string[];
    try {
      pages = await this.pdf.pages(readable.bytes);
    } catch (error) {
      if (error instanceof UnreadablePdfError) {
        throw new UnprocessableEntityException('The PDF could not be read');
      }
      throw error;
    }
    if (pages.every((page) => page.trim() === '')) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message:
          'The PDF contains no text (a scan?) — enter the balances by hand',
        code: 'noText',
      });
    }
    return { payload: buildStatementPayload(file.displayName, pages), pages };
  }
}
