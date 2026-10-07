import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  type ActivityProgress,
  ActivityService,
} from '../../../../core/activity/activity.service';
import { apiErrorText, type ErrorText } from '../../../../core/api/api-error';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  LibraryEntry,
  MappingSummary,
  PrivacyFinding,
  PublishQuota,
  PublishReview,
} from '../../../../core/api/api.types';

/** What happens to one selected mapping. */
export type BulkMode = 'new' | 'version' | 'skip';

export type BulkResult =
  | { readonly state: 'published'; readonly entry: LibraryEntry }
  | { readonly state: 'already'; readonly libraryId: string | null }
  | {
      readonly state: 'refused';
      readonly code: string | null;
      readonly error: ErrorText | null;
    };

export interface BulkItem {
  readonly mapping: MappingSummary;
  /** The first review's findings (what the checkboxes list). */
  readonly findings: readonly PrivacyFinding[];
  /** Ticked for removal (JSON Pointers into the original spec). */
  readonly selected: ReadonlySet<string>;
  /** The review with the current removals — exactly what would be published. */
  readonly review: PublishReview | null;
  readonly reviewFailed: boolean;
  readonly mode: BulkMode;
  readonly result: BulkResult | null;
}

/** Why an item cannot be published (shown instead of its options). */
export type BulkBlock = 'libraryCopy' | 'tooLarge' | 'reviewFailed';

export function blockOf(item: BulkItem): BulkBlock | null {
  if (item.reviewFailed) return 'reviewFailed';
  const review = item.review;
  if (!review) return null;
  if (review.libraryCopy && !review.existing) return 'libraryCopy';
  if (review.size > review.maxSize) return 'tooLarge';
  return null;
}

/** Items that will be sent (not blocked, not skipped, reviewed). */
export function publishable(item: BulkItem): boolean {
  return item.review !== null && blockOf(item) === null && item.mode !== 'skip';
}

/**
 * F5.20 "In Bibliothek veröffentlichen" for several mappings at once (Mappings page, web only).
 * Every mapping still goes through the privacy review of F5.15 — no bulk bypass: each is reviewed
 * (`POST /api/library/review`), its findings listed and removable as in the single dialog, the
 * pseudonym is asked once for all, then one explicit confirmation (+ keeping remaining findings
 * on purpose), and only then are they published **one by one** with the same request as the
 * single dialog — the server's rules (confirmation, privacy scan, daily cap of new entries, HTTP
 * budget, size) apply to each. Per-item results: published / already published (offer a new
 * version) / refused with the reason. Before starting, the quota (`GET /api/library/quota`) says
 * whether the selection exceeds what is left today. Copies taken from the library cannot become
 * new entries (409 `libraryCopy`) — blocked here with the explanation.
 */
@Injectable()
export class BulkPublishService {
  private readonly http = inject(HttpClient);
  private readonly activity = inject(ActivityService);

  readonly open = signal(false);
  readonly items = signal<readonly BulkItem[]>([]);
  readonly quota = signal<PublishQuota | null>(null);
  readonly loading = signal(false);
  readonly authorName = signal('');
  readonly confirmed = signal(false);
  readonly acknowledged = signal(false);
  readonly phase = signal<'review' | 'running' | 'done'>('review');
  private readonly progress = signal<ActivityProgress | null>(null);
  /** Called after a run that published something (the host reloads). */
  onPublished: (() => void) | undefined;

  readonly toPublish = computed(() => this.items().filter(publishable));
  readonly newCount = computed(
    () => this.toPublish().filter((item) => item.mode === 'new').length,
  );
  /** More new entries than are left today: the rest will be refused (429 publishLimit). */
  readonly exceedsToday = computed(() => {
    const quota = this.quota();
    return quota !== null && this.newCount() > quota.remainingToday;
  });
  /** More publishes than the 10-minute budget allows (versions count too). */
  readonly exceedsBudget = computed(() => {
    const quota = this.quota();
    return quota !== null && this.toPublish().length > quota.publishesPer10Min;
  });
  readonly remainingFindings = computed(() =>
    this.toPublish().reduce(
      (sum, item) => sum + (item.review?.findings.length ?? 0),
      0,
    ),
  );
  readonly canPublish = computed(
    () =>
      this.phase() === 'review' &&
      !this.loading() &&
      this.items().every((item) => item.review !== null || item.reviewFailed) &&
      this.toPublish().length > 0 &&
      this.confirmed() &&
      (this.remainingFindings() === 0 || this.acknowledged()),
  );
  readonly counts = computed(() => {
    const results = this.items().map((item) => item.result?.state);
    return {
      published: results.filter((state) => state === 'published').length,
      already: results.filter((state) => state === 'already').length,
      refused: results.filter((state) => state === 'refused').length,
    };
  });

  /** Opens the dialog for these mappings and reviews each (sequentially). */
  async start(mappings: readonly MappingSummary[]): Promise<void> {
    this.items.set(
      mappings.map((mapping) => ({
        mapping,
        findings: [],
        selected: new Set<string>(),
        review: null,
        reviewFailed: false,
        mode: 'new',
        result: null,
      })),
    );
    this.quota.set(null);
    this.authorName.set('');
    this.confirmed.set(false);
    this.acknowledged.set(false);
    this.phase.set('review');
    this.open.set(true);
    this.loading.set(true);
    try {
      void this.loadQuota();
      let pseudonym: string | null = null;
      for (const mapping of mappings) {
        const first = await this.review(mapping.id, []);
        if (!first) {
          this.patch(mapping.id, { reviewFailed: true });
          continue;
        }
        pseudonym ??= first.lastAuthorName;
        const selected = new Set(
          first.findings.filter((f) => f.removable).map((f) => f.path),
        );
        const cleaned =
          selected.size > 0
            ? await this.review(mapping.id, [...selected])
            : first;
        this.patch(mapping.id, {
          findings: first.findings,
          selected,
          review: cleaned ?? first,
          reviewFailed: cleaned === undefined,
          // Already published from this mapping: a new version is the natural default.
          mode: first.existing ? 'version' : 'new',
        });
      }
      this.authorName.set(pseudonym ?? '');
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    if (this.phase() === 'running') return;
    this.open.set(false);
  }

  private readonly sequences = new Map<string, number>();

  /** A finding ticked or unticked: that mapping is reviewed again (stale answers dropped). */
  async toggle(mappingId: string, path: string): Promise<void> {
    const item = this.find(mappingId);
    if (!item || this.phase() !== 'review') return;
    const selected = new Set(item.selected);
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    this.patch(mappingId, { selected });
    const mine = (this.sequences.get(mappingId) ?? 0) + 1;
    this.sequences.set(mappingId, mine);
    const review = await this.review(mappingId, [...selected]);
    if (review && this.sequences.get(mappingId) === mine) {
      this.patch(mappingId, { review });
    }
  }

  setMode(mappingId: string, mode: BulkMode): void {
    this.patch(mappingId, { mode });
  }

  /** Publishes every publishable item one by one, as the single dialog would. */
  async publishAll(): Promise<void> {
    if (!this.canPublish()) return;
    const queue = this.toPublish();
    this.phase.set('running');
    this.progress.set({ done: 0, total: queue.length });
    try {
      await this.activity.track(
        'activity.libraryBulkPublish',
        async () => {
          for (const [index, item] of queue.entries()) {
            this.patch(item.mapping.id, {
              result: await this.publishOne(item, item.mode === 'version'),
            });
            this.progress.set({ done: index + 1, total: queue.length });
          }
        },
        { params: { count: queue.length }, progress: this.progress },
      );
    } finally {
      this.progress.set(null);
      this.phase.set('done');
      void this.loadQuota();
      if (this.counts().published > 0) this.onPublished?.();
    }
  }

  /** "Neue Version" for an item that was already published unchanged. */
  async publishVersion(mappingId: string): Promise<void> {
    const item = this.find(mappingId);
    const result = item?.result;
    if (!item || result?.state !== 'already' || !result.libraryId) return;
    const next = await this.publishOne(item, true, result.libraryId);
    this.patch(mappingId, { result: next });
    if (next.state === 'published') this.onPublished?.();
  }

  private async publishOne(
    item: BulkItem,
    asVersion: boolean,
    libraryId?: string,
  ): Promise<BulkResult> {
    const target =
      libraryId ?? (asVersion ? item.review?.existing?.id : undefined);
    try {
      const entry = await firstValueFrom(
        this.http.post<LibraryEntry>(apiUrl('/library'), {
          mappingId: item.mapping.id,
          remove: [...item.selected],
          authorName: this.authorName().trim() || null,
          confirmed: true,
          acknowledgeFindings: this.acknowledged(),
          ...(target ? { libraryId: target } : {}),
        }),
      );
      return { state: 'published', entry };
    } catch (error) {
      const body =
        error instanceof HttpErrorResponse
          ? (error.error as { code?: unknown; libraryId?: unknown } | null)
          : null;
      const code = typeof body?.code === 'string' ? body.code : null;
      if (code === 'alreadyPublished') {
        return {
          state: 'already',
          libraryId:
            typeof body?.libraryId === 'string' ? body.libraryId : null,
        };
      }
      return {
        state: 'refused',
        code:
          code ??
          (error instanceof HttpErrorResponse && error.status === 429
            ? 'rateLimited'
            : null),
        error: apiErrorText(error) ?? null,
      };
    }
  }

  private async loadQuota(): Promise<void> {
    try {
      this.quota.set(
        await firstValueFrom(
          this.http.get<PublishQuota>(apiUrl('/library/quota')),
        ),
      );
    } catch {
      this.quota.set(null);
    }
  }

  private async review(
    mappingId: string,
    remove: string[],
  ): Promise<PublishReview | undefined> {
    try {
      return await firstValueFrom(
        this.http.post<PublishReview>(apiUrl('/library/review'), {
          mappingId,
          remove,
        }),
      );
    } catch {
      return undefined;
    }
  }

  private find(mappingId: string): BulkItem | undefined {
    return this.items().find((item) => item.mapping.id === mappingId);
  }

  private patch(mappingId: string, change: Partial<BulkItem>): void {
    this.items.update((items) =>
      items.map((item) =>
        item.mapping.id === mappingId ? { ...item, ...change } : item,
      ),
    );
  }
}
