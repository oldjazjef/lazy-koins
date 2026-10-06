import type {
  EstvCheck,
  EstvExport,
  EstvRate,
  EstvVersion,
} from '../domain/estv';

/** Where a running download stands — shown while "ESTV-Kursliste aktualisieren" runs. */
export interface EstvProgress {
  readonly phase: 'metadata' | 'download' | 'parse' | 'store';
  /** Bytes downloaded (download) or XML bytes read (parse). */
  readonly bytes: number;
  /** Total bytes when known (ZIP size, XML size). */
  readonly totalBytes: number | null;
  /** Year-end values found so far. */
  readonly entries: number;
}

/** A Kursliste read from the official ZIP: only what lazy-koins needs. */
export interface ParsedKursliste {
  /** The `year` attribute of the list. */
  readonly year: number;
  /** XML namespace version (`2.0.0`, `2.2.0`). */
  readonly schemaVersion: string;
  readonly rates: readonly EstvRate[];
}

/** Why a Kursliste could not be fetched; `message` is safe to show and store. */
export class EstvSourceError extends Error {
  constructor(
    readonly code:
      | 'network'
      | 'timeout'
      | 'http'
      | 'badResponse'
      | 'tooLarge'
      | 'badArchive'
      | 'badXml'
      | 'notFound',
    message: string,
  ) {
    super(message);
    this.name = 'EstvSourceError';
  }
}

/**
 * The ICTax API (F7.4a): lists the exports of a tax year and downloads + reads one. The adapter
 * (`integrations/rates/ictax/`) streams the ZIP to a temporary file and stream-parses the XML —
 * the full list is hundreds of MB. Bound in `IntegrationsModule`; specs use a fake HTTP server.
 */
export abstract class EstvKurslisteSourcePort {
  abstract listExports(year: number): Promise<EstvExport[]>;

  abstract fetchKursliste(
    year: number,
    file: EstvExport,
    onProgress?: (progress: EstvProgress) => void,
  ): Promise<ParsedKursliste>;
}

/** The deployment-wide Kursliste store (`estv_kursliste`, `estv_rate`, `estv_check`). */
export abstract class EstvKurslisteRepositoryPort {
  /** Every stored version, newest year first. */
  abstract listVersions(): Promise<EstvVersion[]>;

  abstract findVersion(year: number): Promise<EstvVersion | undefined>;

  /** The year-end values of the stored version of `year` (empty when none). */
  abstract listRates(year: number): Promise<EstvRate[]>;

  /** Replaces the year's version and all its values in one transaction. */
  abstract replaceYear(
    version: EstvVersion,
    rates: readonly EstvRate[],
  ): Promise<void>;

  abstract listChecks(): Promise<EstvCheck[]>;

  abstract saveCheck(check: EstvCheck): Promise<void>;
}
