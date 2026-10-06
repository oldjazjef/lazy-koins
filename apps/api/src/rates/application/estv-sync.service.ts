import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { LOCAL_UID } from '../../integrations/local-identity.verifier';
import { SettingsReader } from '../../settings/application/settings.handlers';
import { UserRepositoryPort } from '../../users/ports/user.repository.port';
import {
  type EstvCheck,
  type EstvCheckOutcome,
  type EstvVersion,
  estvSourceLabel,
  isNewerExport,
  selectLatestInitialExport,
} from '../domain/estv';
import {
  EstvKurslisteRepositoryPort,
  EstvKurslisteSourcePort,
  type EstvProgress,
  EstvSourceError,
} from '../ports/estv.port';

/** The oldest tax year the ICTax API is asked for. */
export const ESTV_FIRST_YEAR = 2017;

/** What a running update is doing — polled by the app while "ESTV-Kursliste aktualisieren" runs. */
export interface EstvRunState {
  readonly years: readonly number[];
  readonly year: number;
  readonly startedAt: string;
  readonly progress: EstvProgress;
}

export interface EstvYearStatus {
  readonly year: number;
  readonly version:
    (EstvVersion & { readonly label: string; readonly fxCount: number }) | null;
  readonly check: EstvCheck | null;
}

export interface EstvStatus {
  /** `ESTV_AUTO` and `RATES_ONLINE` allow downloads at all. */
  readonly autoEnabled: boolean;
  readonly running: EstvRunState | null;
  /** The newest check of any year. */
  readonly lastCheckAt: string | null;
  readonly years: readonly EstvYearStatus[];
}

export interface EstvYearResult {
  readonly year: number;
  readonly outcome: EstvCheckOutcome;
  readonly error: string | null;
}

function message(error: unknown): string {
  if (error instanceof EstvSourceError) return error.message;
  return 'Die ESTV-Kursliste konnte nicht verarbeitet werden';
}

/**
 * The deployment-wide ESTV Kursliste (F7.4a): checks the ICTax API for each tax year and
 * downloads a year's list only when a newer export exists (other file hash, not older). One run
 * at a time; its progress is kept for polling. Every outcome is stored as the year's check
 * (`estv_check`), errors included — the status shows them.
 */
@Injectable()
export class EstvSyncService {
  private readonly logger = new Logger('EstvSync');
  private current: EstvRunState | null = null;
  private running: Promise<EstvYearResult[]> | null = null;
  /** The clock (replaced in specs). */
  now: () => Date = () => new Date();

  constructor(
    private readonly source: EstvKurslisteSourcePort,
    private readonly store: EstvKurslisteRepositoryPort,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** `ESTV_AUTO` and `RATES_ONLINE` both allow it (F7.4a, F11.3). */
  autoEnabled(): boolean {
    return (
      this.config.get('ESTV_AUTO', { infer: true }) !== 'false' &&
      this.config.get('RATES_ONLINE', { infer: true }) !== 'false'
    );
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  /** The years a periodic check covers: every stored year plus last year. */
  async yearsToCheck(): Promise<number[]> {
    const lastYear = this.now().getUTCFullYear() - 1;
    const stored = (await this.store.listVersions()).map((v) => v.year);
    return [...new Set([lastYear, ...stored])]
      .filter((y) => y >= ESTV_FIRST_YEAR && y <= lastYear + 1)
      .sort((a, b) => b - a);
  }

  /**
   * Starts a run for `years`. While one runs, a request it covers joins it; any other waits for
   * it and then runs (one download at a time). Resolves when the covering run has finished.
   */
  run(years: readonly number[]): Promise<EstvYearResult[]> {
    const ordered = [...new Set(years)].sort((a, b) => b - a);
    if (this.running) {
      const covering = this.current?.years ?? [];
      if (ordered.every((y) => covering.includes(y))) return this.running;
      return this.running.then(() => this.run(ordered));
    }
    this.running = this.runYears(ordered).finally(() => {
      this.running = null;
      this.current = null;
    });
    return this.running;
  }

  async status(): Promise<EstvStatus> {
    const [versions, checks] = await Promise.all([
      this.store.listVersions(),
      this.store.listChecks(),
    ]);
    const years = [
      ...new Set([
        ...versions.map((v) => v.year),
        ...checks.map((c) => c.year),
      ]),
    ].sort((a, b) => b - a);
    const result: EstvYearStatus[] = [];
    for (const year of years) {
      const version = versions.find((v) => v.year === year);
      const fxCount = version
        ? (await this.store.listRates(year)).filter((r) => r.kind === 'fx')
            .length
        : 0;
      result.push({
        year,
        version: version
          ? {
              ...version,
              label: estvSourceLabel(year, version.exportDate),
              fxCount,
            }
          : null,
        check: checks.find((c) => c.year === year) ?? null,
      });
    }
    return {
      autoEnabled: this.autoEnabled(),
      running: this.current,
      lastCheckAt: checks.reduce<string | null>(
        (latest, c) =>
          latest === null || c.checkedAt > latest ? c.checkedAt : latest,
        null,
      ),
      years: result,
    };
  }

  private async runYears(years: readonly number[]): Promise<EstvYearResult[]> {
    const startedAt = this.now().toISOString();
    const results: EstvYearResult[] = [];
    for (const year of years) {
      this.current = {
        years,
        year,
        startedAt,
        progress: { phase: 'metadata', bytes: 0, totalBytes: null, entries: 0 },
      };
      results.push(await this.checkYear(year));
    }
    return results;
  }

  private async checkYear(year: number): Promise<EstvYearResult> {
    let outcome: EstvCheckOutcome;
    let error: string | null = null;
    try {
      outcome = await this.updateYear(year);
    } catch (failure) {
      outcome = 'failed';
      error = message(failure);
      this.logger.warn(`ESTV-Kursliste ${year}: ${error}`);
    }
    await this.store.saveCheck({
      year,
      checkedAt: this.now().toISOString(),
      outcome,
      error,
    });
    return { year, outcome, error };
  }

  private async updateYear(year: number): Promise<EstvCheckOutcome> {
    const exports = await this.source.listExports(year);
    const latest = selectLatestInitialExport(exports);
    if (!latest) {
      throw new EstvSourceError(
        'notFound',
        `Für ${year} gibt es noch keine ESTV-Kursliste`,
      );
    }
    const stored = (await this.store.findVersion(year)) ?? null;
    if (!isNewerExport(stored, latest)) return 'current';
    const parsed = await this.source.fetchKursliste(
      year,
      latest,
      (progress) => {
        if (this.current) this.current = { ...this.current, progress };
      },
    );
    const cryptoCount = parsed.rates.filter((r) => r.kind === 'crypto').length;
    if (parsed.rates.length === 0) {
      throw new EstvSourceError(
        'badXml',
        'Die Kursliste enthält keine Jahresendkurse für Devisen oder Kryptowährungen',
      );
    }
    if (this.current) {
      this.current = {
        ...this.current,
        progress: {
          phase: 'store',
          bytes: this.current.progress.bytes,
          totalBytes: this.current.progress.totalBytes,
          entries: parsed.rates.length,
        },
      };
    }
    await this.store.replaceYear(
      {
        year,
        exportType: latest.exportType,
        exportDate: latest.exportDate,
        fileHash: latest.fileHash,
        fileName: latest.fileName,
        schemaVersion: parsed.schemaVersion,
        downloadedAt: this.now().toISOString(),
        entryCount: parsed.rates.length,
        cryptoCount,
      },
      parsed.rates,
    );
    this.logger.log(
      `ESTV-Kursliste ${year} (${latest.exportType}, ${latest.exportDate}): ${parsed.rates.length} Werte, ${cryptoCount} Kryptowährungen`,
    );
    return 'updated';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The periodic check (F7.4a): shortly after start (the desktop app: on every start) and then
 * every 24 h, only with `ESTV_AUTO`/`RATES_ONLINE` on and — in the single-user desktop mode — the
 * user's "Kursabfragen aus dem Internet" (F11.3). Never in tests.
 */
@Injectable()
export class EstvScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('EstvScheduler');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly sync: EstvSyncService,
    private readonly users: UserRepositoryPort,
    private readonly settings: SettingsReader,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    if (!this.sync.autoEnabled()) return;
    const first = setTimeout(() => void this.tick(), 60_000);
    const daily = setInterval(() => void this.tick(), DAY_MS);
    first.unref();
    daily.unref();
    this.timers = [first, daily];
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** One periodic check; public for specs. */
  async tick(): Promise<void> {
    try {
      if (!this.sync.autoEnabled() || !(await this.allowedByUser())) return;
      await this.sync.run(await this.sync.yearsToCheck());
    } catch (error) {
      this.logger.warn(`ESTV check failed: ${(error as Error).message}`);
    }
  }

  /** Desktop (`AUTH_MODE=local`): the one user's F11.3 switch; web: the deployment decides. */
  private async allowedByUser(): Promise<boolean> {
    if (this.config.get('AUTH_MODE', { infer: true }) !== 'local') return true;
    const principal = await this.users.findPrincipalByIdentityUid(LOCAL_UID);
    if (!principal) return true;
    return (await this.settings.resolve(principal.id)).onlineRates;
  }
}
