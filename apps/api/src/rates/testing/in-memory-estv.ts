import type {
  EstvCheck,
  EstvExport,
  EstvRate,
  EstvVersion,
} from '../domain/estv';
import {
  EstvKurslisteRepositoryPort,
  EstvKurslisteSourcePort,
  type EstvProgress,
  EstvSourceError,
  type ParsedKursliste,
} from '../ports/estv.port';

/** Port double: the Kursliste store over Maps. */
export class InMemoryEstvRepository extends EstvKurslisteRepositoryPort {
  readonly versions = new Map<number, EstvVersion>();
  readonly rates = new Map<number, EstvRate[]>();
  readonly checks = new Map<number, EstvCheck>();

  async listVersions(): Promise<EstvVersion[]> {
    return [...this.versions.values()].sort((a, b) => b.year - a.year);
  }

  async findVersion(year: number): Promise<EstvVersion | undefined> {
    return this.versions.get(year);
  }

  async listRates(year: number): Promise<EstvRate[]> {
    return [...(this.rates.get(year) ?? [])];
  }

  async replaceYear(
    version: EstvVersion,
    rates: readonly EstvRate[],
  ): Promise<void> {
    this.versions.set(version.year, version);
    this.rates.set(version.year, [...rates]);
  }

  async listChecks(): Promise<EstvCheck[]> {
    return [...this.checks.values()].sort((a, b) => b.year - a.year);
  }

  async saveCheck(check: EstvCheck): Promise<void> {
    this.checks.set(check.year, check);
  }
}

export const crypto = (
  symbol: string,
  name: string,
  value: string,
  valorNumber: string | null = null,
): EstvRate => ({
  kind: 'crypto',
  ictaxId: `id-${symbol}-${valorNumber ?? name}`,
  symbol,
  name,
  valorNumber,
  isin: null,
  value,
});

export const fx = (symbol: string, value: string): EstvRate => ({
  kind: 'fx',
  ictaxId: null,
  symbol,
  name: symbol,
  valorNumber: null,
  isin: null,
  value,
});

/** Fake ICTax: canned exports and lists per year, every call recorded — no network. */
export class FakeEstvSource extends EstvKurslisteSourcePort {
  readonly calls: string[] = [];
  exports = new Map<number, EstvExport[]>();
  lists = new Map<string, ParsedKursliste>();
  failWith: EstvSourceError | undefined;

  async listExports(year: number): Promise<EstvExport[]> {
    this.calls.push(`list ${year}`);
    if (this.failWith) throw this.failWith;
    return this.exports.get(year) ?? [];
  }

  async fetchKursliste(
    year: number,
    file: EstvExport,
    onProgress?: (progress: EstvProgress) => void,
  ): Promise<ParsedKursliste> {
    this.calls.push(`fetch ${year} ${file.fileHash}`);
    onProgress?.({ phase: 'download', bytes: 10, totalBytes: 10, entries: 0 });
    const list = this.lists.get(file.fileHash);
    if (!list) throw new EstvSourceError('notFound', 'not found');
    return list;
  }
}
