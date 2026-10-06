import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { decodeText } from '@lazykoins/engine';
import { orUnreadable, readableOf } from '../../files/application/file-access';
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
import {
  buildMappingSample,
  guessDelimiter,
  type MappingSample,
} from '../domain/mapping-sample';
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
    let csv:
      { encoding: string; delimiter: ',' | ';' | '\t' | '|' } | undefined;
    if (readable.kind === 'csv') {
      const decoded = decodeText(readable.bytes);
      csv = {
        encoding: decoded.encoding,
        delimiter: guessDelimiter(decoded.text),
      };
    }
    const source = await orUnreadable(() =>
      this.reader.read(readable, csv ? { delimiter: csv.delimiter } : {}),
    );
    return { sample: buildMappingSample(source, csv), readable };
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
