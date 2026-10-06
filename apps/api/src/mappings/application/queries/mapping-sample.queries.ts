import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  type KindSummary,
  kindSummary,
  type MappingSample,
  mappingConfidence,
  type MappingSpecInput,
  specSkeleton,
  validateMappingSpec,
} from '@lazykoins/engine';
import { orUnreadable } from '../../../files/application/file-access';
import { FileAnalysisService } from '../../../files/application/file-analysis.service';
import type { MappingPreview } from '../../../files/application/queries/preview-mapping.query';
import {
  type ReadableFile,
  SourceFileReader,
} from '../../../files/application/source-file-reader';
import { ImportMappingRepositoryPort } from '../../ports/import-mapping.repository.port';
import { type Recognition, readSampleTable, recognise } from '../sample-file';

export interface SpecIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * The mapping editor's **sample file** ("Beispieldatei"): stateless — the bytes come with every
 * request and nothing is stored. Inspect = the raw table + a spec skeleton; preview = what an
 * (unsaved) spec makes of the whole file, and whether an upload would recognise the file by it.
 */

export class InspectSampleQuery {
  constructor(
    readonly userId: string,
    readonly file: ReadableFile,
  ) {}
}

export interface SampleInspection {
  readonly name: string;
  readonly kind: 'csv' | 'xlsx';
  readonly size: number;
  /** The raw table as the AI would see it (F5.14): first rows incl. preamble, header guess. */
  readonly sample: MappingSample;
  /** "Vorlage aus Datei": the editor's starting point (not necessarily valid yet). */
  readonly skeleton: MappingSpecInput;
  /** What an upload would read the file with today (standard format or one of my mappings). */
  readonly recognisedBy: Recognition;
}

@QueryHandler(InspectSampleQuery)
export class InspectSampleHandler implements IQueryHandler<
  InspectSampleQuery,
  SampleInspection
> {
  constructor(
    private readonly reader: SourceFileReader,
    private readonly mappings: ImportMappingRepositoryPort,
  ) {}

  async execute({
    userId,
    file,
  }: InspectSampleQuery): Promise<SampleInspection> {
    const { sample } = await readSampleTable(this.reader, file);
    const header = sample.headerRowGuess - 1;
    const asUploaded = await orUnreadable(() => this.reader.read(file));
    return {
      name: file.name,
      kind: sample.fileKind,
      size: file.bytes.length,
      sample,
      skeleton: specSkeleton({
        fileName: file.name,
        fileKind: sample.fileKind,
        sheet: sample.sheet,
        delimiter: sample.delimiter,
        headers: sample.rows[header] ?? [],
        rows: sample.rows.slice(header + 1),
        distinctValues: sample.distinctValues,
      }),
      recognisedBy: recognise(
        asUploaded,
        await this.mappings.findByOwner(userId),
      ),
    };
  }
}

export class PreviewSampleQuery {
  constructor(
    readonly userId: string,
    readonly file: ReadableFile,
    /** The editor's spec — untrusted, maybe invalid (then only its issues come back). */
    readonly spec: unknown,
    readonly limit: number,
    /** The mapping being edited: not its own competitor in the fingerprint check. */
    readonly mappingId?: string,
  ) {}
}

/**
 * - `this`: an upload of this file would be read with this spec;
 * - `other`: another mapping of mine is surer (`recognisedBy.mapping`);
 * - `standard`: it is in the standard format — mappings are not consulted;
 * - `none`: the spec's `match` does not fit this file.
 */
export type FingerprintVerdict = 'this' | 'other' | 'standard' | 'none';

export interface SamplePreview extends KindSummary {
  readonly valid: boolean;
  readonly issues: readonly SpecIssue[];
  /** `null` while the spec is invalid. */
  readonly preview: MappingPreview | null;
  readonly fingerprint: {
    readonly verdict: FingerprintVerdict;
    /** The spec's own confidence for this file (0 = no match). */
    readonly confidence: number;
    readonly recognisedBy: Recognition;
  } | null;
}

@QueryHandler(PreviewSampleQuery)
export class PreviewSampleHandler implements IQueryHandler<
  PreviewSampleQuery,
  SamplePreview
> {
  constructor(
    private readonly reader: SourceFileReader,
    private readonly analysis: FileAnalysisService,
    private readonly mappings: ImportMappingRepositoryPort,
  ) {}

  async execute({
    userId,
    file,
    spec,
    limit,
    mappingId,
  }: PreviewSampleQuery): Promise<SamplePreview> {
    const validation = validateMappingSpec(spec);
    if (!validation.ok) {
      return {
        valid: false,
        issues: validation.issues,
        preview: null,
        fingerprint: null,
        kindCounts: {},
        unknownValues: [],
      };
    }
    const full = await orUnreadable(() =>
      this.analysis.apply(file, validation.spec),
    );
    // Recognition works on the file as an upload reads it — without the spec's CSV options.
    const asUploaded = await orUnreadable(() => this.reader.read(file));
    const confidence = mappingConfidence(validation.spec, asUploaded);
    const recognisedBy = recognise(
      asUploaded,
      await this.mappings.findByOwner(userId),
      mappingId,
    );
    return {
      valid: true,
      issues: [],
      preview: {
        result: {
          bookings: full.bookings.slice(0, limit),
          holdings: full.holdings.slice(0, limit),
          errors: full.errors.slice(0, limit),
          notes: full.notes.slice(0, limit),
          period: full.period,
        },
        totals: {
          bookings: full.bookings.length,
          holdings: full.holdings.length,
          errors: full.errors.length,
          notes: full.notes.length,
        },
      },
      ...kindSummary(full),
      fingerprint: {
        verdict: verdictOf(confidence, recognisedBy),
        confidence,
        recognisedBy,
      },
    };
  }
}

/** A saved spec is the most recently changed: it wins a tie (`FileAnalysisService.analyse`). */
export function verdictOf(
  confidence: number,
  recognisedBy: Recognition,
): FingerprintVerdict {
  if (recognisedBy.standard) return 'standard';
  if (confidence <= 0) return 'none';
  const other = recognisedBy.mapping;
  return other && other.confidence > confidence ? 'other' : 'this';
}
