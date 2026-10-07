import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../core/actions/action';
import { ActionRunner } from '../../core/actions/action-runner';
import { apiUrl } from '../../core/api/api-url';
import type {
  LibraryEntry,
  TakenLibraryMapping,
} from '../../core/api/api.types';
import { NotificationService } from '../../core/notifications/notification.service';

/** Take = a private copy, optionally assigned to one of my files right away. */
export interface TakeTarget {
  readonly projectId: string;
  readonly projectFileId: string;
}

/**
 * F5.15–F5.17: the mapping library's mutations shared by the library pages, the files area
 * ("Aus Bibliothek übernehmen") and a mapping's page — take (always a private copy), rate,
 * delete my entry. Messages are i18n keys; the runner shows failures by their API code.
 */
@Injectable({ providedIn: 'root' })
export class LibraryClient {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  private readonly takeAction = defineAction<
    { id: string; target?: TakeTarget },
    TakenLibraryMapping
  >({
    run: ({ id, target }) =>
      firstValueFrom(
        this.http.post<TakenLibraryMapping>(
          apiUrl(`/library/${id}/take`),
          target ?? {},
        ),
      ),
    messages: { error: 'library.take.failed' },
  });

  private readonly rateAction = defineAction<
    { id: string; stars: number | null },
    LibraryEntry
  >({
    run: ({ id, stars }) =>
      firstValueFrom(
        stars === null
          ? this.http.delete<LibraryEntry>(apiUrl(`/library/${id}/rating`))
          : this.http.put<LibraryEntry>(apiUrl(`/library/${id}/rating`), {
              stars,
            }),
      ),
    messages: { error: 'library.rate.failed' },
  });

  private readonly deleteAction = defineAction<string, void>({
    run: (id) =>
      firstValueFrom(this.http.delete<void>(apiUrl(`/library/${id}`))),
    messages: {
      success: 'library.delete.done',
      error: 'library.delete.failed',
    },
  });

  /**
   * Copies the entry into my mappings (and assigns it to the file when given). The toast links
   * to the copy's page. Resolves `undefined` when it failed (the runner has told the user).
   */
  async take(
    id: string,
    target?: TakeTarget,
  ): Promise<TakenLibraryMapping | undefined> {
    try {
      const taken = await this.actions.run(
        this.takeAction,
        { id, target },
        {
          key: `library-take:${id}`,
          activity: { label: 'activity.libraryTake' },
        },
      );
      this.notifications.success(
        target
          ? 'library.take.doneAssigned'
          : taken.created
            ? 'library.take.done'
            : 'library.take.existing',
        {
          labelKey: 'mappings.openPage',
          onClick: () =>
            void this.router.navigate(['/app/mappings', taken.mapping.id]),
        },
      );
      return taken;
    } catch {
      return undefined;
    }
  }

  /** My stars (1–5) or `null` to remove them; the updated entry, or `undefined` on failure. */
  async rate(
    id: string,
    stars: number | null,
  ): Promise<LibraryEntry | undefined> {
    try {
      const entry = await this.actions.run(
        this.rateAction,
        { id, stars },
        { key: `library-rate:${id}` },
      );
      this.notifications.success(
        stars === null ? 'library.rate.removed' : 'library.rate.done',
      );
      return entry;
    } catch {
      return undefined;
    }
  }

  /** Removes my entry from the library; copies others took stay. */
  async remove(id: string): Promise<boolean> {
    try {
      await this.actions.run(this.deleteAction, id, {
        key: `library-delete:${id}`,
      });
      return true;
    } catch {
      return false;
    }
  }
}
