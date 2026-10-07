import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  applyMapping,
  type Booking,
  type CalculationInput,
  type Correction,
  countryRules,
  type CountryRules,
  ENGINE_VERSION,
  type Holding,
  parseStandardFile,
  preferFetchedSources,
  type PreviousYear,
  type RateEntry,
  type WalletState,
  withTaxCurrency,
} from '@lazykoins/engine';
import { walletStates } from '../../wallets/domain/wallet-states';
import { WalletRepositoryPort } from '../../wallets/ports/wallet.repository.port';
import { readableOf } from '../../files/application/file-access';
import {
  SourceFileReader,
  UnreadableFileError,
} from '../../files/application/source-file-reader';
import {
  type ProjectFile,
  readsRecords,
} from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import type { Project } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { marketAmbiguityOf } from '../../rates/application/coin-market.service';
import {
  ambiguousSymbols,
  type CoinChoices,
  priceSourceUsable,
} from '../../rates/domain/coin-choice';
import {
  DEFAULT_PRICE_PROVIDERS,
  providerOrder,
} from '../../rates/domain/price-providers';
import { CoinMarketRepositoryPort } from '../../rates/ports/coin-market.repository.port';
import { ProjectRateRepositoryPort } from '../../rates/ports/project-rate.repository.port';
import { UserSettingsRepositoryPort } from '../../settings/ports/user-settings.repository.port';
import type { FileRef, StoredCorrection } from '../domain/calculation';
import {
  CalculationSnapshotRepositoryPort,
  CorrectionRepositoryPort,
} from '../ports/calculation.repository.port';

/** What a calculation needs, assembled from storage — and its hash (F7.6). */
export interface AssembledInput {
  readonly input: CalculationInput;
  readonly files: readonly FileRef[];
  readonly inputHash: string;
  /** Project files that could not be read this time (counted, never their content). */
  readonly unreadable: number;
}

interface Sources {
  readonly files: readonly ProjectFile[];
  readonly mappings: ReadonlyMap<string, ImportMapping>;
  readonly corrections: readonly StoredCorrection[];
  readonly rates: readonly RateEntry[];
  readonly previous: PreviousYear | undefined;
  readonly previousRef: string | null;
  /** F6.4: the project's wallets per network (only the wallet check reads them). */
  readonly wallets: readonly WalletState[];
  /** F7.4: tickers of several coins without a chosen coin (open item, no by-ticker price). */
  readonly ambiguousAssets: readonly string[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Collects the calculation's input for a project: the standard records of every readable, active
 * file (standard format or its mapping — read again from the original bytes, bookings are not
 * stored as rows; deactivated files are skipped, F5.7a), the active corrections, the stored
 * rates and the previous year's closing figures.
 *
 * The **input hash** covers what decides the result without reading file contents: the files'
 * SHA-256 + how they are read (mapping id + version time), corrections, rates, the previous
 * year's snapshot and the engine version. Same hash → same result.
 */
@Injectable()
export class CalculationInputService {
  private readonly logger = new Logger(CalculationInputService.name);

  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly rates: ProjectRateRepositoryPort,
    private readonly corrections: CorrectionRepositoryPort,
    private readonly snapshots: CalculationSnapshotRepositoryPort,
    private readonly reader: SourceFileReader,
    private readonly wallets: WalletRepositoryPort,
    private readonly settings: UserSettingsRepositoryPort,
    /** F7.4: the deployment-wide market list (shared tickers); absent in older specs. */
    @Optional() private readonly market?: CoinMarketRepositoryPort,
  ) {}

  /** The input hash alone — cheap (no file is read); tells whether a snapshot is stale. */
  async inputHash(project: Project): Promise<string> {
    return hashOf(project, await this.sources(project));
  }

  /**
   * F7.6: a snapshot is stale when another engine computed it or anything that decides the
   * result changed since (files added/removed/reassigned, a mapping edited, corrections, rates,
   * wallets, the tax currency, the previous year) — the one rule for result, list and header.
   */
  async isStale(
    project: Project,
    snapshot: { readonly inputHash: string; readonly engineVersion: number },
  ): Promise<boolean> {
    return (
      snapshot.engineVersion !== ENGINE_VERSION ||
      (await this.inputHash(project)) !== snapshot.inputHash
    );
  }

  async build(project: Project): Promise<AssembledInput> {
    const rules = projectRules(project);
    const sources = await this.sources(project);
    const bookings: Booking[] = [];
    const holdings: Holding[] = [];
    let unreadable = 0;
    for (const file of sources.files) {
      try {
        const records = await this.recordsOf(file, sources.mappings);
        if (!records) continue;
        bookings.push(...records.bookings);
        holdings.push(...records.holdings);
      } catch (error) {
        if (!(error instanceof UnreadableFileError)) throw error;
        unreadable += 1;
      }
    }
    this.logger.log(
      `project ${project.id}: ${bookings.length} bookings, ${holdings.length} balances from ${sources.files.length} files (${unreadable} unreadable)`,
    );
    const corrections: Correction[] = sources.corrections
      .filter((c) => c.undoneAt === null)
      .map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        reason: c.reason,
        data: c.data,
      }));
    return {
      input: {
        taxYear: project.taxYear,
        rules,
        bookings,
        holdings,
        corrections,
        rates: sources.rates,
        previous: sources.previous,
        wallets: sources.wallets,
        ambiguousAssets: sources.ambiguousAssets,
      },
      files: sources.files.map((f) => ({
        projectFileId: f.id,
        sha256: f.sha256,
        displayName: f.displayName,
      })),
      inputHash: hashOf(project, sources),
      unreadable,
    };
  }

  /** The project's files as the calculation names them (F7.5). */
  async fileRefs(projectId: string): Promise<FileRef[]> {
    return (await this.files.listByProject(projectId)).map((f) => ({
      projectFileId: f.id,
      sha256: f.sha256,
      displayName: f.displayName,
    }));
  }

  private async sources(project: Project): Promise<Sources> {
    // F5.7a: a deactivated file is not read — and leaves the input hash, so the snapshot is stale.
    const files = (await this.files.listByProject(project.id))
      .filter(readsRecords)
      .sort((a, b) => compareText(a.sha256, b.sha256));
    const mappings = new Map<string, ImportMapping>();
    for (const file of files) {
      if (file.mappingId && !mappings.has(file.mappingId)) {
        const mapping = await this.mappings.findById(file.mappingId);
        // Defence in depth (F11.16 audit): only the project owner's own mappings are ever used.
        if (mapping && mapping.ownerId === project.ownerId) {
          mappings.set(mapping.id, mapping);
        }
      }
    }
    // F7.4: the owner's coin per ticker — a by-ticker price (Binance) of a chosen or ambiguous
    // ticker may be another coin's and never counts (filtered here, so it is out of the hash too).
    // Ambiguous = the hand-kept list + tickers the stored market list shows without a clear
    // leader (local data, works offline).
    const owner = await this.settings.find(project.ownerId);
    const choices: CoinChoices = owner?.coinChoices ?? {};
    const marketAmbiguous = await marketAmbiguityOf(this.market, choices);
    // Price sources phase 2: among fetched series, the owner's provider order decides per day
    // (`preferFetchedSources`) — before the hash, so a new order that changes a value is stale.
    const rates: RateEntry[] = preferFetchedSources(
      (await this.rates.listByProject(project.id))
        .filter(
          (r) =>
            r.kind !== 'price' ||
            priceSourceUsable(r.asset, r.source, choices, marketAmbiguous),
        )
        .map((r) => ({
          kind: r.kind,
          asset: r.asset,
          currency: r.currency,
          date: r.date,
          value: r.value,
          source: r.source,
        })),
      providerOrder(owner?.priceSources ?? DEFAULT_PRICE_PROVIDERS),
    );
    const corrections = await this.corrections.listByProject(project.id);
    const { previous, ref } = await this.previousYear(project);
    return {
      files,
      mappings,
      corrections,
      rates,
      previous,
      previousRef: ref,
      wallets: await this.walletStates(project),
      ambiguousAssets: ambiguousSymbols(choices, marketAmbiguous),
    };
  }

  private async walletStates(project: Project): Promise<WalletState[]> {
    const ids = await this.wallets.listWalletIds(project.id);
    if (ids.length === 0) return [];
    const wallets = (await this.wallets.findByIds(ids)).filter(
      (w) => w.ownerId === project.ownerId,
    );
    return walletStates(
      wallets,
      await this.wallets.listData(ids),
      await this.wallets.listBalances(project.id),
      `${project.taxYear}-12-31`,
    );
  }

  /**
   * The owner's project of the year before (same country and tax currency — its values are
   * compared), via its latest snapshot.
   */
  private async previousYear(
    project: Project,
  ): Promise<{ previous: PreviousYear | undefined; ref: string | null }> {
    const candidates = (await this.projects.findByOwner(project.ownerId))
      .filter(
        (p) =>
          p.taxYear === project.taxYear - 1 &&
          p.country === project.country &&
          p.taxCurrency === project.taxCurrency,
      )
      .sort((a, b) => compareText(b.updatedAt, a.updatedAt));
    for (const candidate of candidates) {
      const snapshot = await this.snapshots.latest(candidate.id);
      if (!snapshot) continue;
      return {
        ref: snapshot.id,
        previous: {
          taxYear: candidate.taxYear,
          wealthChf: snapshot.result.totals.wealthChf,
          incomeChf: snapshot.result.totals.incomeChf,
          positions: snapshot.result.positions
            .filter((p) => p.status !== 'spam')
            .map((p) => ({
              platform: p.platform,
              accountId: p.accountId,
              asset: p.asset,
              quantity: p.quantity,
              valueChf: p.valueChf,
            })),
        },
      };
    }
    return { previous: undefined, ref: null };
  }

  /** The standard records of one project file (read again from its bytes); `undefined` without a mapping. */
  async recordsOf(
    file: ProjectFile,
    mappings: ReadonlyMap<string, ImportMapping>,
  ): Promise<
    { bookings: readonly Booking[]; holdings: readonly Holding[] } | undefined
  > {
    const { readable } = await readableOf(this.files, file);
    if (file.status === 'standard') {
      return parseStandardFile(await this.reader.read(readable));
    }
    const mapping = file.mappingId ? mappings.get(file.mappingId) : undefined;
    if (!mapping) return undefined;
    const source = await this.reader.read(readable, {
      encoding: mapping.spec.source.encoding,
      delimiter: mapping.spec.source.delimiter,
    });
    return applyMapping(mapping.spec, source);
  }
}

/**
 * The country's rules valued in the project's tax currency (F4.1a) — what every calculation,
 * export and dashboard of the project runs on.
 */
export function projectRules(
  project: Pick<Project, 'country' | 'taxCurrency'>,
): CountryRules {
  const rules = countryRules(project.country);
  if (!rules) throw new Error(`No country rules for ${project.country}`);
  return withTaxCurrency(rules, project.taxCurrency);
}

function hashOf(project: Project, sources: Sources): string {
  const canonical = {
    engineVersion: ENGINE_VERSION,
    taxYear: project.taxYear,
    country: project.country,
    // F4.1a: another tax currency values everything anew.
    currency: project.taxCurrency,
    files: sources.files.map((f) => [
      f.sha256,
      f.status,
      f.mappingId,
      f.mappingId
        ? (sources.mappings.get(f.mappingId)?.updatedAt ?? null)
        : null,
    ]),
    corrections: sources.corrections
      .filter((c) => c.undoneAt === null)
      .map((c) => [c.id, c.createdAt, c.data]),
    rates: [...sources.rates]
      .map(
        (r) =>
          `${r.kind}|${r.asset}|${r.currency}|${r.date}|${r.source}|${r.value}`,
      )
      .sort(compareText),
    previous: sources.previousRef,
    wallets: sources.wallets,
    // F7.4: choosing a coin for an ambiguous ticker settles its open item.
    ambiguous: sources.ambiguousAssets,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
