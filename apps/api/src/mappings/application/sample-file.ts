import { createHash } from 'node:crypto';
import {
  BadRequestException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  buildMappingSample,
  decodeText,
  defaultImporterRegistry,
  guessDelimiter,
  type MappingSample,
  mappingImporter,
  type SourceFile,
  STANDARD_IMPORTER_ID,
} from '@lazykoins/engine';
import { orUnreadable } from '../../files/application/file-access';
import type {
  ReadableFile,
  SourceFileReader,
} from '../../files/application/source-file-reader';
import {
  cleanFileName,
  MAX_FILE_BYTES,
  sniffFileKind,
} from '../../files/domain/project-file';
import type { ImportMapping } from '../domain/import-mapping';

/**
 * A **sample file** for the mapping editor ("Beispieldatei"): bytes the user picked (or one of
 * their project files, downloaded by the app) sent along with each request and **never stored** —
 * not as a BLOB, not in a project, not in a log. Same limits as an upload (F5.1), but only tables:
 * a mapping reads CSV/XLSX.
 */
export function sampleFileOf(name: string, bytes: Uint8Array): ReadableFile {
  const displayName = cleanFileName(name);
  if (!displayName) {
    throw new BadRequestException('name: a file name is required');
  }
  if (bytes.length === 0) throw new BadRequestException('The file is empty');
  if (bytes.length > MAX_FILE_BYTES) {
    throw new PayloadTooLargeException(
      `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`,
    );
  }
  const kind = sniffFileKind(bytes);
  if (!kind) {
    throw new UnsupportedMediaTypeException(
      'Only CSV and XLSX files can be a sample',
    );
  }
  if (kind === 'pdf') {
    throw new UnprocessableEntityException(
      'A mapping reads tables (CSV, XLSX), not PDFs',
    );
  }
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    name: displayName,
    kind,
    bytes,
  };
}

export interface SampleTable {
  /** The file read with the guessed delimiter (the sample's view of it). */
  readonly source: SourceFile;
  readonly sample: MappingSample;
}

/**
 * The file's sample as the AI would get it (F5.14) — also the editor's raw table: CSV decoded,
 * delimiter guessed over the first lines (a one-cell preamble must not win), first rows as they
 * are, category-like columns. 422 for a workbook that cannot be unpacked.
 */
export async function readSampleTable(
  reader: SourceFileReader,
  readable: ReadableFile,
): Promise<SampleTable> {
  if (readable.kind === 'pdf') {
    throw new UnprocessableEntityException(
      'A mapping reads tables (CSV, XLSX), not PDFs',
    );
  }
  let csv: { encoding: string; delimiter: ',' | ';' | '\t' | '|' } | undefined;
  if (readable.kind === 'csv') {
    const decoded = decodeText(readable.bytes);
    csv = {
      encoding: decoded.encoding,
      delimiter: guessDelimiter(decoded.text),
    };
  }
  const source = await orUnreadable(() =>
    reader.read(readable, csv ? { delimiter: csv.delimiter } : {}),
  );
  return { source, sample: buildMappingSample(source, csv) };
}

/** Which reader the upload (F5.2) would pick for a file: the standard format, a mapping, or none. */
export interface Recognition {
  readonly standard: boolean;
  /** The mapping the upload would read it with (ignored when `standard`). */
  readonly mapping: {
    readonly id: string;
    readonly name: string;
    readonly confidence: number;
  } | null;
}

/**
 * The same choice as `FileAnalysisService.analyse` on upload: the file read **without** a spec's
 * CSV options (as on upload), the standard format wins outright, then the surest mapping, then the
 * most recently changed. `exclude` leaves out the mapping being edited.
 */
export function recognise(
  source: SourceFile,
  owned: readonly ImportMapping[],
  exclude?: string,
): Recognition {
  const candidates = defaultImporterRegistry(
    owned
      .filter((mapping) => mapping.id !== exclude)
      .map((mapping) => mappingImporter(mapping.id, mapping.spec)),
  ).candidates(source);
  const standard = candidates.some(
    (candidate) => candidate.importer.id === STANDARD_IMPORTER_ID,
  );
  const best = candidates.find(
    (candidate) => candidate.importer.id !== STANDARD_IMPORTER_ID,
  );
  if (!best) return { standard, mapping: null };
  const tied = owned
    .filter((mapping) =>
      candidates.some(
        (c) =>
          c.confidence === best.confidence &&
          c.importer.id === `mapping:${mapping.id}`,
      ),
    )
    .sort(
      (a, b) => compare(b.updatedAt, a.updatedAt) || compare(b.id, a.id),
    )[0];
  return {
    standard,
    mapping: tied
      ? { id: tied.id, name: tied.name, confidence: best.confidence }
      : null,
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
