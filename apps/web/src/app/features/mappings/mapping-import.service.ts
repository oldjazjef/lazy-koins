import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  type ActivityProgress,
  ActivityService,
} from '../../core/activity/activity.service';
import { apiErrorText, type ErrorText } from '../../core/api/api-error';
import { apiUrl } from '../../core/api/api-url';
import type { Mapping, SpecIssue } from '../../core/api/api.types';
import { NotificationService } from '../../core/notifications/notification.service';
import { parseSpecText } from '../files/components/mapping-editor';
import { specIssues } from './pages/mappings-page/mappings-page.service';

/** Files per batch — one request each, inside the per-account write budget (120 / 10 min). */
export const MAX_MAPPING_FILES = 50;
/** A mapping JSON larger than this is surely not one (the library allows 64 KB). */
export const MAX_MAPPING_FILE_BYTES = 1024 * 1024;

export type MappingImportOutcome =
  | {
      readonly name: string;
      readonly state: 'stored';
      readonly mapping: Mapping;
    }
  | {
      readonly name: string;
      readonly state: 'duplicate';
      readonly existingId: string | null;
      readonly existingName: string | null;
    }
  | {
      readonly name: string;
      readonly state: 'invalid';
      readonly issues: readonly SpecIssue[];
    }
  | { readonly name: string; readonly state: 'notJson' }
  | { readonly name: string; readonly state: 'tooLarge' }
  | { readonly name: string; readonly state: 'tooMany' }
  | {
      readonly name: string;
      readonly state: 'failed';
      readonly error: ErrorText | null;
    };

/**
 * F11.0u "Mapping hochladen" with several `.json` at once (Mappings page, a project's mappings
 * section): each file on its own — parsed here, validated (`validateMappingSpec`) and stored by
 * the API with `rejectDuplicate` (a spec I already have is skipped, 409 `duplicateMapping`).
 * One failing file never stops the others; the batch runs in the ActivityService with its
 * progress, and the results (stored / duplicate / invalid with the issues) stay in `results`
 * for the dialog. A single stored file just gets the toast with a link, as before.
 */
@Injectable({ providedIn: 'root' })
export class MappingImportService {
  private readonly http = inject(HttpClient);
  private readonly activity = inject(ActivityService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  /** The last batch's results; the dialog is open while set. */
  readonly results = signal<readonly MappingImportOutcome[] | null>(null);
  private readonly progressState = signal<ActivityProgress | null>(null);
  readonly running = computed(() => this.progressState() !== null);
  readonly summary = computed(() => {
    const results = this.results() ?? [];
    const count = (state: MappingImportOutcome['state']) =>
      results.filter((result) => result.state === state).length;
    return {
      stored: count('stored'),
      duplicate: count('duplicate'),
      problems: results.length - count('stored') - count('duplicate'),
    };
  });

  async importFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0 || this.running()) return;
    const outcomes = await this.activity.track(
      'activity.mappingImport',
      () => this.run(files),
      { params: { count: files.length }, progress: this.progressState },
    );
    const [only] = outcomes;
    if (outcomes.length === 1 && only?.state === 'stored') {
      this.notifications.success('mappings.saved', {
        labelKey: 'mappings.openPage',
        onClick: () =>
          void this.router.navigate(['/app/mappings', only.mapping.id]),
      });
      return;
    }
    this.results.set(outcomes);
  }

  close(): void {
    this.results.set(null);
  }

  private async run(files: readonly File[]): Promise<MappingImportOutcome[]> {
    const out: MappingImportOutcome[] = [];
    this.progressState.set({ done: 0, total: files.length });
    try {
      for (const [index, file] of files.entries()) {
        out.push(
          index >= MAX_MAPPING_FILES
            ? { name: file.name, state: 'tooMany' }
            : await this.one(file),
        );
        this.progressState.set({ done: index + 1, total: files.length });
      }
    } finally {
      this.progressState.set(null);
    }
    return out;
  }

  private async one(file: File): Promise<MappingImportOutcome> {
    const name = file.name;
    if (file.size > MAX_MAPPING_FILE_BYTES) return { name, state: 'tooLarge' };
    const parsed = parseSpecText(await file.text());
    if (
      !parsed ||
      typeof parsed.value !== 'object' ||
      parsed.value === null ||
      Array.isArray(parsed.value)
    ) {
      return { name, state: 'notJson' };
    }
    try {
      const mapping = await firstValueFrom(
        this.http.post<Mapping>(apiUrl('/mappings'), {
          spec: parsed.value,
          origin: 'copied',
          rejectDuplicate: true,
        }),
      );
      return { name, state: 'stored', mapping };
    } catch (error) {
      const issues = specIssues(error);
      if (issues) return { name, state: 'invalid', issues };
      if (
        error instanceof HttpErrorResponse &&
        error.status === 409 &&
        (error.error as { code?: unknown } | null)?.code === 'duplicateMapping'
      ) {
        const body = error.error as {
          existingId?: unknown;
          existingName?: unknown;
        };
        return {
          name,
          state: 'duplicate',
          existingId:
            typeof body.existingId === 'string' ? body.existingId : null,
          existingName:
            typeof body.existingName === 'string' ? body.existingName : null,
        };
      }
      return { name, state: 'failed', error: apiErrorText(error) ?? null };
    }
  }
}
