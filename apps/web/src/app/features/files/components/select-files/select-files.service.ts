import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import type {
  FileCandidate,
  SelectFilesResult,
} from '../../../../core/api/api.types';
import { apiUrl } from '../../../../core/api/api-url';
import { NotificationService } from '../../../../core/notifications/notification.service';

/**
 * F5.22 "Dateien auswählen": my files (from the global list) for one project — the ones that
 * touch its tax year or hold balances at 31.12. are ticked in advance, nothing is added
 * without "Hinzufügen".
 */
@Injectable()
export class SelectFilesService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);

  readonly candidates = signal<readonly FileCandidate[] | null>(null);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly search = signal('');
  /** Only the files that fit the tax year. */
  readonly onlySuggested = signal(false);

  readonly visible = computed(() => {
    const needle = this.search().trim().toLocaleLowerCase('de-CH');
    return (this.candidates() ?? []).filter(
      (f) =>
        (!this.onlySuggested() || f.suggested || f.selected) &&
        (!needle ||
          f.name.toLocaleLowerCase('de-CH').includes(needle) ||
          (f.platform ?? '').toLocaleLowerCase('de-CH').includes(needle)),
    );
  });

  async load(projectId: string): Promise<void> {
    this.candidates.set(null);
    this.selected.set(new Set());
    this.search.set('');
    try {
      const candidates = await firstValueFrom(
        this.http.get<FileCandidate[]>(
          apiUrl(`/projects/${projectId}/file-candidates`),
        ),
      );
      this.candidates.set(candidates);
      this.selected.set(
        new Set(
          candidates.filter((f) => f.suggested && !f.selected).map((f) => f.id),
        ),
      );
    } catch {
      this.candidates.set([]);
      this.notifications.error('files.select.loadFailed');
    }
  }

  toggle(id: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** All / none of the files on screen (files already in the project stay as they are). */
  setVisible(all: boolean): void {
    this.selected.update((set) => {
      const next = new Set(set);
      for (const file of this.visible()) {
        if (file.selected) continue;
        if (all) next.add(file.id);
        else next.delete(file.id);
      }
      return next;
    });
  }

  private readonly selectAction = defineAction<
    { projectId: string; ids: string[] },
    SelectFilesResult
  >({
    run: ({ projectId, ids }) =>
      firstValueFrom(
        this.http.post<SelectFilesResult>(
          apiUrl(`/projects/${projectId}/files/select`),
          { fileIds: ids },
        ),
      ),
    messages: { error: 'files.select.failed' },
  });

  private readonly status = this.actions.status<unknown>('select-files');
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  async add(projectId: string): Promise<number> {
    const result = await this.actions.run(
      this.selectAction,
      { projectId, ids: [...this.selected()] },
      { key: 'select-files' },
    );
    this.notifications.info('files.select.done', { count: result.added });
    return result.added;
  }
}
