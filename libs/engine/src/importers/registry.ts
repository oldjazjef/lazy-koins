import type { Confidence, Importer, SourceFile } from './importer';

export interface Candidate {
  readonly importer: Importer;
  readonly confidence: Confidence;
}

/**
 * The outcome of automatic detection (F5.2):
 *
 * - `match`: exactly one importer is clearly best;
 * - `ambiguous`: several are (nearly) equally sure — the user assigns the file by hand, and the
 *   importers involved need a sharper `detect()` (an `add-importer` test for the lookalike);
 * - `unknown`: nobody claims the file — assign manually or keep it as "nur Beleg".
 */
export type Detection =
  | {
      readonly status: 'match';
      readonly importer: Importer;
      readonly confidence: Confidence;
    }
  | { readonly status: 'ambiguous'; readonly candidates: readonly Candidate[] }
  | { readonly status: 'unknown' };

export interface RegistryOptions {
  /**
   * Two candidates whose confidences differ by no more than this are a tie. Default 0.1: an
   * importer must be clearly surer than the next one to win on its own.
   */
  readonly ambiguityMargin?: number;
}

const DEFAULT_AMBIGUITY_MARGIN = 0.1;

/**
 * Every importer the engine knows, and the detection over them. Pure and deterministic: the same
 * file always yields the same answer, independent of registration order (candidates are sorted
 * by confidence, then id).
 */
export class ImporterRegistry {
  private readonly byId: ReadonlyMap<string, Importer>;
  private readonly margin: number;

  constructor(importers: readonly Importer[], options: RegistryOptions = {}) {
    const byId = new Map<string, Importer>();
    for (const importer of importers) {
      if (byId.has(importer.id)) {
        throw new Error(`Duplicate importer id: ${importer.id}`);
      }
      byId.set(importer.id, importer);
    }
    this.byId = byId;
    this.margin = options.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN;
    if (!(this.margin >= 0 && this.margin < 1)) {
      throw new RangeError(
        `ambiguityMargin must be in [0, 1), got ${this.margin}`,
      );
    }
  }

  get importers(): readonly Importer[] {
    return [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): Importer | undefined {
    return this.byId.get(id);
  }

  /** Every importer of the file's kind that claims it, surest first. */
  candidates(file: SourceFile): Candidate[] {
    return this.importers
      .filter((importer) => importer.fileKind === file.kind)
      .map((importer) => ({ importer, confidence: safeDetect(importer, file) }))
      .filter((candidate) => candidate.confidence > 0)
      .sort(
        (a, b) =>
          b.confidence - a.confidence ||
          a.importer.id.localeCompare(b.importer.id),
      );
  }

  detect(file: SourceFile): Detection {
    const [best, ...rest] = this.candidates(file);
    if (!best) return { status: 'unknown' };
    const ties = rest.filter(
      (candidate) => best.confidence - candidate.confidence <= this.margin,
    );
    if (ties.length > 0) {
      return { status: 'ambiguous', candidates: [best, ...ties] };
    }
    return {
      status: 'match',
      importer: best.importer,
      confidence: best.confidence,
    };
  }
}

/**
 * `detect()` must never throw — but a registry must not fall over when one does: a throwing or
 * nonsensical (`NaN`, negative, > 1) answer counts as "not mine" / is clamped to certainty.
 */
function safeDetect(importer: Importer, file: SourceFile): Confidence {
  let confidence: number;
  try {
    confidence = importer.detect(file);
  } catch {
    return 0;
  }
  if (!Number.isFinite(confidence) || confidence <= 0) return 0;
  return Math.min(confidence, 1);
}

/**
 * The importers the app uses. Empty until the first platform lands (F5.2 lists them: Kraken,
 * Binance, Bitfinex, Bittrex, Revolut) — add each one here.
 */
export const IMPORTERS: readonly Importer[] = [];

export function defaultImporterRegistry(): ImporterRegistry {
  return new ImporterRegistry(IMPORTERS);
}
