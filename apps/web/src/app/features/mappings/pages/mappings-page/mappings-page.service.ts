import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
} from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  Mapping,
  MappingSummary,
  SpecIssue,
} from '../../../../core/api/api.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { parseSpecText } from '../../../files/components/mapping-editor';

export const MAPPING_SORTS = ['name', 'platform', 'updated', 'files'] as const;
export type MappingSort = (typeof MAPPING_SORTS)[number];

/** Saving a spec: the stored mapping, or every schema issue (a 400 is not a failure toast). */
export type SaveOutcome =
  | { readonly ok: true; readonly mapping: Mapping }
  | { readonly ok: false; readonly issues: readonly SpecIssue[] };

/**
 * F11.0: every mapping of mine — they apply to all my projects — searchable by name and platform,
 * sortable, with how many files use each. New mappings come from the editor or an uploaded
 * `.json`; the API validates them.
 */
@Injectable({ providedIn: 'root' })
export class MappingsPageService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly mappings = httpResource<MappingSummary[]>(() => apiUrl('/mappings'));

  readonly search = signal('');
  readonly sort = signal<MappingSort>('name');

  readonly isEmpty = computed(
    () => this.mappings.hasValue() && this.mappings.value().length === 0,
  );

  /** The list as shown: filtered by the search (name or platform), then sorted. */
  readonly visible = computed<MappingSummary[]>(() => {
    const all = this.mappings.hasValue() ? this.mappings.value() : [];
    const needle = this.search().trim().toLocaleLowerCase('de-CH');
    const matching = needle
      ? all.filter(
          (mapping) =>
            mapping.name.toLocaleLowerCase('de-CH').includes(needle) ||
            mapping.platform.toLocaleLowerCase('de-CH').includes(needle),
        )
      : all;
    return [...matching].sort(comparator(this.sort()));
  });

  refresh(): void {
    this.mappings.reload();
  }

  /** A new mapping from the editor (origin `manual`); opens its page once stored. */
  async create(text: string): Promise<SaveOutcome | 'invalidJson'> {
    const parsed = parseSpecText(text);
    if (!parsed) return 'invalidJson';
    const outcome = await this.post(parsed.value, 'manual');
    if (outcome.ok) {
      this.notifications.success('mappings.saved');
      this.refresh();
      await this.router.navigate(['/app/mappings', outcome.mapping.id]);
    }
    return outcome;
  }

  /** An uploaded `.json` (origin `copied`): parsed here, validated and stored by the API. */
  async upload(file: File): Promise<Mapping | undefined> {
    const parsed = parseSpecText(await file.text());
    if (!parsed) {
      this.notifications.error('mappings.upload.notJson', file.name);
      return undefined;
    }
    try {
      const outcome = await this.post(parsed.value, 'copied');
      if (!outcome.ok) {
        this.notifications.error(
          'mappings.upload.invalid',
          outcome.issues
            .map((issue) => `${issue.path || '/'}: ${issue.message}`)
            .join('; '),
        );
        return undefined;
      }
      this.notifications.success('mappings.saved', {
        labelKey: 'mappings.openPage',
        onClick: () =>
          void this.router.navigate(['/app/mappings', outcome.mapping.id]),
      });
      this.refresh();
      return outcome.mapping;
    } catch {
      return undefined;
    }
  }

  private async post(
    spec: unknown,
    origin: 'manual' | 'copied',
  ): Promise<SaveOutcome> {
    try {
      const mapping = await firstValueFrom(
        this.http.post<Mapping>(apiUrl('/mappings'), { spec, origin }),
      );
      return { ok: true, mapping };
    } catch (error) {
      const issues = specIssues(error);
      if (issues) return { ok: false, issues };
      this.notifications.error('mappings.saveFailed');
      throw error;
    }
  }
}

function comparator(
  sort: MappingSort,
): (a: MappingSummary, b: MappingSummary) => number {
  const byName = (a: MappingSummary, b: MappingSummary) =>
    a.name.localeCompare(b.name, 'de-CH') || a.id.localeCompare(b.id);
  switch (sort) {
    case 'platform':
      return (a, b) =>
        a.platform.localeCompare(b.platform, 'de-CH') || byName(a, b);
    case 'updated':
      // ISO timestamps sort as text; newest first.
      return (a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b);
    case 'files':
      return (a, b) => b.filesUsing - a.filesUsing || byName(a, b);
    default:
      return byName;
  }
}

/** The issues of a 400 for an invalid spec (or its message as one issue). */
export function specIssues(error: unknown): readonly SpecIssue[] | undefined {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) {
    return undefined;
  }
  const body = error.error as {
    issues?: SpecIssue[];
    message?: unknown;
  } | null;
  if (Array.isArray(body?.issues)) return body.issues;
  const message = body?.message;
  return [
    {
      path: '',
      message: Array.isArray(message)
        ? message.join('; ')
        : String(message ?? ''),
    },
  ];
}
