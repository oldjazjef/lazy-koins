import { Injectable, Logger } from '@nestjs/common';
import {
  applyTransactionEdits,
  type Booking,
  type BookingKind,
  chRules,
  countryRules,
  dashboardRates,
  formatFixed,
  preferFetchedSources,
  RateTable,
  type TransactionEffect,
  transactionKeys,
  unitPriceChf,
  withTaxCurrency,
} from '@lazykoins/engine';
import { CalculationInputService } from '../../calculation/application/calculation-input.service';
import { DashboardInputService } from '../../dashboard/application/dashboard-input.service';
import { UnreadableFileError } from '../../files/application/source-file-reader';
import type { UserFile } from '../../files/domain/project-file';
import { ProjectFileRepositoryPort } from '../../files/ports/project-file.repository.port';
import type { ImportMapping } from '../../mappings/domain/import-mapping';
import { ImportMappingRepositoryPort } from '../../mappings/ports/import-mapping.repository.port';
import type { Project } from '../../projects/domain/project';
import { ProjectRepositoryPort } from '../../projects/ports/project.repository.port';
import { originWalletId } from '../../wallets/domain/wallet';
import {
  engineEdits,
  type StoredTransactionEdit,
  type TransactionSuggestion,
} from '../domain/transaction-edit';
import { TransactionEditRepositoryPort } from '../ports/transaction-edit.repository.port';

/** A project that uses a transaction (through its file). */
export interface TransactionProject {
  readonly projectId: string;
  readonly name: string;
  readonly taxYear: number;
  readonly status: Project['status'];
  /** The file is active there (F5.7a). */
  readonly active: boolean;
}

/** One transaction of the user (F9.5) — the edited booking and where it comes from. */
export interface LedgerEntry {
  readonly key: string;
  /** As the calculation sees it (edits applied; for a hidden one: as imported). */
  readonly booking: Booking;
  readonly original: Booking;
  readonly effect: TransactionEffect | null;
  readonly file: {
    readonly id: string;
    readonly name: string;
    readonly walletId: string | null;
    /** The mapping it is read with (null = standard format). */
    readonly mappingId: string | null;
  };
  readonly projects: readonly TransactionProject[];
  /** F9.9: closed projects that use it — it cannot be changed until they are reopened. */
  readonly lockedBy: readonly TransactionProject[];
  /** Value in the ledger's currency at the booking's day (|quantity| × price); null = no price. */
  readonly value: string | null;
  readonly suggestion: TransactionSuggestion | null;
}

export interface Ledger {
  /** The currency of every `value` (the newest project's tax currency, else CHF). */
  readonly currency: string;
  /** Newest first (then key). */
  readonly entries: readonly LedgerEntry[];
  readonly byKey: ReadonlyMap<string, LedgerEntry>;
  readonly edits: readonly StoredTransactionEdit[];
  /** Files that could not be read this time (counted, never their content). */
  readonly unreadable: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * F9.5: every transaction of the user — every readable file of mine (F5.21, also files in no
 * project) and every wallet fetch, read again from the bytes (bookings are not rows), keyed
 * stably (`transactionKeys`), with the global edits (F9.8) applied exactly as in every project.
 * A wallet's older fetch files carry the same keys: the newest file wins.
 */
@Injectable()
export class TransactionLedgerService {
  private readonly logger = new Logger(TransactionLedgerService.name);

  constructor(
    private readonly files: ProjectFileRepositoryPort,
    private readonly mappings: ImportMappingRepositoryPort,
    private readonly projects: ProjectRepositoryPort,
    private readonly inputs: CalculationInputService,
    private readonly dashboard: DashboardInputService,
    private readonly edits: TransactionEditRepositoryPort,
  ) {}

  async ledger(userId: string): Promise<Ledger> {
    const files = (await this.files.listByOwner(userId))
      .filter((f) => f.status === 'standard' || f.status === 'mapped')
      // Newest first: the newest wallet fetch wins a key.
      .sort(
        (a, b) =>
          compareText(b.createdAt, a.createdAt) || compareText(a.id, b.id),
      );
    const mappings = new Map<string, ImportMapping>();
    for (const file of files) {
      if (file.mappingId && !mappings.has(file.mappingId)) {
        const mapping = await this.mappings.findById(file.mappingId);
        // Defence in depth (F11.16): only the user's own mappings are ever used.
        if (mapping && mapping.ownerId === userId) {
          mappings.set(mapping.id, mapping);
        }
      }
    }
    const projects = new Map(
      (await this.projects.findByOwner(userId)).map((p) => [p.id, p] as const),
    );

    const imported: Booking[] = [];
    const keys = new Map<string, string>();
    const fileOf = new Map<string, UserFile>();
    const seen = new Set<string>();
    let unreadable = 0;
    for (const file of files) {
      try {
        const records = await this.inputs.recordsOfStored(file, mappings);
        if (!records) continue;
        const walletId = originWalletId(file.source) ?? null;
        const fileKeys = transactionKeys(records.bookings, walletId);
        for (const booking of records.bookings) {
          const key = fileKeys.get(booking.id) ?? booking.id;
          if (seen.has(key)) continue;
          seen.add(key);
          keys.set(booking.id, key);
          fileOf.set(booking.id, file);
          imported.push(booking);
        }
      } catch (error) {
        if (!(error instanceof UnreadableFileError)) throw error;
        unreadable += 1;
      }
    }

    const stored = await this.edits.listByOwner(userId);
    const applied = applyTransactionEdits(
      imported,
      (b) => keys.get(b.id) ?? b.id,
      engineEdits(stored),
    );
    const edited = new Map(applied.bookings.map((b) => [b.id, b] as const));
    const suggestions = new Map(
      (await this.edits.listSuggestions(userId))
        .filter((s) => s.status === 'open')
        .map((s) => [s.key, s] as const),
    );

    const { currency, value } = await this.valuation(userId);
    const entries: LedgerEntry[] = imported.map((original) => {
      const key = keys.get(original.id) ?? original.id;
      const file = fileOf.get(original.id) as UserFile;
      const booking = edited.get(original.id) ?? original;
      const used: TransactionProject[] = file.usages.flatMap((usage) => {
        const project = projects.get(usage.projectId);
        return project
          ? [
              {
                projectId: project.id,
                name: project.name,
                taxYear: project.taxYear,
                status: project.status,
                active: usage.active,
              },
            ]
          : [];
      });
      const unique = [
        ...new Map(used.map((p) => [p.projectId, p] as const)).values(),
      ].sort((a, b) => b.taxYear - a.taxYear || compareText(a.name, b.name));
      return {
        key,
        booking,
        original,
        effect: applied.effects.get(original.id) ?? null,
        file: {
          id: file.id,
          name: file.originalName,
          walletId: originWalletId(file.source) ?? null,
          mappingId: file.mappingId,
        },
        projects: unique,
        lockedBy: unique.filter((p) => p.status === 'closed'),
        value: value(booking),
        suggestion: suggestions.get(key) ?? null,
      };
    });
    entries.sort(
      (a, b) =>
        compareText(b.booking.timestamp, a.booking.timestamp) ||
        compareText(a.key, b.key),
    );
    this.logger.log(
      `user ${userId}: ${entries.length} transactions from ${files.length} files (${unreadable} unreadable)`,
    );
    return {
      currency,
      entries,
      byKey: new Map(entries.map((e) => [e.key, e] as const)),
      edits: stored,
      unreadable,
    };
  }

  /** Values with the dashboard's rates (every project's + the user's cache), in its currency. */
  private async valuation(userId: string): Promise<{
    currency: string;
    value: (booking: Booking) => string | null;
  }> {
    const sources = await this.dashboard.sources(userId);
    const newest = sources.projects[0];
    const rules = withTaxCurrency(
      (newest ? countryRules(newest.country) : undefined) ?? chRules,
      sources.currency,
    );
    const table = new RateTable(
      preferFetchedSources(
        dashboardRates(
          sources.projects.map((p) => ({ id: p.id, taxYear: p.taxYear })),
          sources.projectRates,
          sources.userRates,
        ),
        sources.sourceOrder,
      ),
      sources.currency,
    );
    return {
      currency: sources.currency,
      value: (booking) => {
        if (booking.quantity.isZero()) return null;
        const quote = unitPriceChf(
          table,
          rules,
          booking.asset,
          booking.timestamp.slice(0, 10),
          { priceChf: booking.priceChf, priceUsd: booking.priceUsd },
        );
        return quote
          ? formatFixed(
              quote.priceChf.times(booking.quantity.abs()),
              2,
              'halfUp',
            )
          : null;
      },
    };
  }
}

/** Whether a booking kind still needs a decision (F9.5 "nur unbekannt / zu prüfen"). */
export function needsReview(kind: BookingKind): boolean {
  return kind === 'unknown';
}
