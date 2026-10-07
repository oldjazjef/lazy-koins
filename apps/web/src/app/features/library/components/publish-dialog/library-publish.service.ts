import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
} from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiErrorText } from '../../../../core/api/api-error';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  LibraryEntry,
  MappingSummary,
  PrivacyFinding,
  PublishReview,
  SpecIssue,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { parseSpecText } from '../../../files/components/mapping-editor';
import { specIssues } from '../../../mappings/pages/mappings-page/mappings-page.service';

/** What to publish: one of my mappings or a spec from a `.json` (exactly one). */
export interface PublishSource {
  readonly mappingId?: string;
  readonly spec?: Record<string, unknown>;
}

export interface PublishStart extends PublishSource {
  /** Publish a new version of this entry of mine. */
  readonly libraryId?: string;
}

/**
 * F5.15 "In Bibliothek veröffentlichen" — the review step before anything becomes public.
 * Provided by the host page (library list, library entry, mapping page); `lk-library-publish-dialog`
 * renders it.
 *
 * 1. the source: one of my mappings or an uploaded `.json` (chosen in the dialog when not given);
 * 2. the review (`POST /api/library/review`): the **exact JSON** that becomes public and the
 *    privacy findings of the original — each removable one ticked for removal; every change of
 *    the selection reviews again, so the JSON shown is always what will be stored;
 * 3. pseudonym (empty = "Anonym", never the profile name), description, the explicit
 *    confirmation, and — when findings remain — keeping them on purpose;
 * 4. `POST /api/library` with the same removals.
 */
@Injectable()
export class LibraryPublishService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly open = signal(false);
  readonly source = signal<PublishSource | null>(null);
  /** The entry of mine a new version is published to (`undefined` = a new entry). */
  readonly libraryId = signal<string | undefined>(undefined);
  /** The findings of the spec as it is (what the checkboxes list). */
  readonly findings = signal<readonly PrivacyFinding[]>([]);
  /** Ticked for removal (JSON Pointers into the original spec). */
  readonly selected = signal<ReadonlySet<string>>(new Set());
  /** The review with the current removals — the JSON shown is exactly what is published. */
  readonly review = signal<PublishReview | null>(null);
  readonly loading = signal(false);
  /** Spec problems of an uploaded `.json` (a 400), or a failed review (an i18n key). */
  readonly issues = signal<readonly SpecIssue[]>([]);
  readonly failure = signal<string | null>(null);

  readonly authorName = signal('');
  readonly description = signal('');
  readonly confirmed = signal(false);
  readonly acknowledged = signal(false);
  readonly busy = signal(false);
  /** Called with the stored entry (the host reloads or navigates). */
  onPublished: ((entry: LibraryEntry) => void) | undefined;

  /** My mappings, for choosing a source in the dialog. */
  readonly myMappings = httpResource<MappingSummary[]>(() =>
    this.open() && this.source() === null ? apiUrl('/mappings') : undefined,
  );

  readonly remaining = computed(() => this.review()?.findings ?? []);
  readonly tooLarge = computed(() => {
    const review = this.review();
    return review !== null && review.size > review.maxSize;
  });
  readonly json = computed(() => {
    const review = this.review();
    return review ? JSON.stringify(review.spec, null, 2) : '';
  });
  /** F5.20: a copy taken from the library cannot become a new entry (409 `libraryCopy`). */
  readonly libraryCopy = computed(() => {
    const review = this.review();
    return review !== null && review.libraryCopy && review.target === null;
  });
  readonly canPublish = computed(
    () =>
      this.review() !== null &&
      !this.libraryCopy() &&
      !this.loading() &&
      !this.busy() &&
      !this.tooLarge() &&
      this.confirmed() &&
      (this.remaining().length === 0 || this.acknowledged()),
  );

  start(start: PublishStart = {}): void {
    this.source.set(null);
    this.libraryId.set(start.libraryId);
    this.findings.set([]);
    this.selected.set(new Set());
    this.review.set(null);
    this.issues.set([]);
    this.failure.set(null);
    this.authorName.set('');
    this.description.set('');
    this.confirmed.set(false);
    this.acknowledged.set(false);
    this.open.set(true);
    if (start.mappingId !== undefined || start.spec !== undefined) {
      void this.use({ mappingId: start.mappingId, spec: start.spec });
    }
  }

  close(): void {
    this.open.set(false);
  }

  /** A source chosen in the dialog (or given by the host): first review, prefill the texts. */
  async use(source: PublishSource): Promise<void> {
    this.source.set(source);
    const first = await this.fetch([]);
    if (!first) return;
    this.findings.set(first.findings);
    this.selected.set(
      new Set(first.findings.filter((f) => f.removable).map((f) => f.path)),
    );
    this.authorName.set(first.lastAuthorName ?? '');
    // Already published from this mapping: the new version is the natural default.
    if (this.libraryId() === undefined && first.existing) {
      this.libraryId.set(first.existing.id);
    }
    await this.refresh();
    // The description field starts from the CLEANED spec — a description the scan flagged (and
    // that is ticked for removal) must not come back through the text field.
    const description = this.review()?.spec['description'];
    this.description.set(typeof description === 'string' ? description : '');
  }

  /** A `.json` picked in the dialog. */
  async useFile(file: File): Promise<void> {
    const parsed = parseSpecText(await file.text());
    if (!parsed || typeof parsed.value !== 'object' || parsed.value === null) {
      this.notifications.error('mappings.upload.notJson', file.name);
      return;
    }
    await this.use({ spec: parsed.value as Record<string, unknown> });
  }

  toggle(path: string): void {
    const next = new Set(this.selected());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this.selected.set(next);
    void this.refresh();
  }

  /** New entry or a new version of my existing one (from the same mapping). */
  asNewVersion(on: boolean): void {
    const existing = this.review()?.existing;
    this.libraryId.set(on && existing ? existing.id : undefined);
    void this.refresh();
  }

  private sequence = 0;

  /** Reviews again with the current selection; a stale answer (the user ticked on) is dropped. */
  async refresh(): Promise<void> {
    const mine = ++this.sequence;
    const review = await this.fetch([...this.selected()]);
    if (review && mine === this.sequence) this.review.set(review);
  }

  async publish(): Promise<void> {
    const source = this.source();
    if (!source || !this.canPublish()) return;
    this.busy.set(true);
    try {
      const entry = await firstValueFrom(
        this.http.post<LibraryEntry>(apiUrl('/library'), {
          ...this.sourceBody(source),
          remove: [...this.selected()],
          description: this.description().trim() || null,
          authorName: this.authorName().trim() || null,
          confirmed: true,
          acknowledgeFindings: this.acknowledged(),
        }),
      );
      this.open.set(false);
      this.notifications.success(
        entry.version > 1
          ? 'library.publish.doneVersion'
          : 'library.publish.done',
        {
          labelKey: 'library.publish.open',
          onClick: () =>
            void this.router.navigate(['/app/mappings/library', entry.id]),
        },
        { version: entry.version },
      );
      this.onPublished?.(entry);
    } catch (error) {
      const detail = apiErrorText(error);
      if (detail) this.notifications.error('library.publish.failed', detail);
      else this.notifications.error('library.publish.failed');
    } finally {
      this.busy.set(false);
    }
  }

  private sourceBody(source: PublishSource) {
    return {
      ...(source.mappingId !== undefined
        ? { mappingId: source.mappingId }
        : {}),
      ...(source.spec !== undefined ? { spec: source.spec } : {}),
      ...(this.libraryId() ? { libraryId: this.libraryId() } : {}),
    };
  }

  private async fetch(remove: string[]): Promise<PublishReview | undefined> {
    const source = this.source();
    if (!source) return undefined;
    this.loading.set(true);
    this.failure.set(null);
    try {
      const review = await firstValueFrom(
        this.http.post<PublishReview>(apiUrl('/library/review'), {
          ...this.sourceBody(source),
          remove,
        }),
      );
      this.issues.set([]);
      return review;
    } catch (error) {
      const issues = specIssues(error);
      if (issues) {
        this.issues.set(issues);
      } else {
        this.failure.set(
          error instanceof HttpErrorResponse && error.status === 404
            ? 'library.publish.notFound'
            : 'library.publish.reviewFailed',
        );
      }
      return undefined;
    } finally {
      this.loading.set(false);
    }
  }
}
