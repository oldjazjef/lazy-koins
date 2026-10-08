import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import type {
  AdminLibraryEntry,
  AdminLibraryFilter,
  AdminPage,
} from '../../../../core/api/admin.types';
import { apiUrl } from '../../../../core/api/api-url';
import { DataChanges, reloadOn } from '../../../../core/data/data-changes';

export const LIBRARY_LIMIT = 200;

/**
 * `/app/admin/library`: moderation of the public mapping library — hide an entry (a reason; its
 * author is notified, copies others took keep working) or show it again.
 */
@Injectable({ providedIn: 'root' })
export class AdminLibraryPageService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly changes = inject(DataChanges);

  readonly query = signal('');
  readonly filter = signal<AdminLibraryFilter>('all');

  readonly entries = httpResource<AdminPage<AdminLibraryEntry>>(() => ({
    url: apiUrl('/admin/library'),
    params: {
      limit: LIBRARY_LIMIT,
      filter: this.filter(),
      ...(this.query().trim() ? { q: this.query().trim() } : {}),
    },
  }));

  readonly rows = computed(() =>
    this.entries.hasValue() ? this.entries.value().items : [],
  );
  readonly total = computed(() =>
    this.entries.hasValue() ? this.entries.value().total : 0,
  );

  follow(): void {
    this.entries.reload();
    reloadOn(() => this.changes.globalVersion('admin'), [this.entries]);
  }

  private readonly hideAction = defineAction<
    { id: string; hidden: boolean; reason: string },
    AdminLibraryEntry
  >({
    run: ({ id, hidden, reason }) =>
      firstValueFrom(
        this.http.post<AdminLibraryEntry>(
          apiUrl(`/admin/library/${id}/${hidden ? 'hide' : 'unhide'}`),
          reason ? { reason } : {},
        ),
      ),
    messages: { error: 'admin.library.failed' },
  });

  hide(entry: AdminLibraryEntry, reason: string): Promise<AdminLibraryEntry> {
    return this.actions.run(this.hideAction, {
      id: entry.id,
      hidden: true,
      reason,
    });
  }

  unhide(entry: AdminLibraryEntry): Promise<AdminLibraryEntry> {
    return this.actions.run(this.hideAction, {
      id: entry.id,
      hidden: false,
      reason: '',
    });
  }
}
