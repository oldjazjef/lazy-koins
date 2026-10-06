import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type { TakeOverSource } from '../../../../core/api/dashboard.types';
import { NotificationService } from '../../../../core/notifications/notification.service';

/**
 * F4.4 "Aus anderem Projekt übernehmen": the files of my other projects (grouped by project
 * and platform), the chosen ones, and the link — the same stored file, no copy.
 */
@Injectable()
export class TakeOverFilesService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);

  readonly sources = signal<readonly TakeOverSource[] | null>(null);
  readonly selected = signal<ReadonlySet<string>>(new Set());

  async load(projectId: string): Promise<void> {
    this.sources.set(null);
    this.selected.set(new Set());
    try {
      this.sources.set(
        await firstValueFrom(
          this.http.get<TakeOverSource[]>(
            apiUrl(`/projects/${projectId}/take-over`),
          ),
        ),
      );
    } catch {
      this.sources.set([]);
      this.notifications.error('files.takeOver.loadFailed');
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

  /** All / none of one source project (files already here stay out). */
  setProject(source: TakeOverSource, all: boolean): void {
    this.selected.update((set) => {
      const next = new Set(set);
      for (const file of source.files) {
        if (file.inTarget) continue;
        if (all) next.add(file.projectFileId);
        else next.delete(file.projectFileId);
      }
      return next;
    });
  }

  private readonly takeOverAction = defineAction<
    { projectId: string; ids: string[] },
    { added: number; skipped: number }
  >({
    run: ({ projectId, ids }) =>
      firstValueFrom(
        this.http.post<{ added: number; skipped: number }>(
          apiUrl(`/projects/${projectId}/take-over`),
          { projectFileIds: ids },
        ),
      ),
    messages: { error: 'files.takeOver.failed' },
  });

  private readonly status = this.actions.status<unknown>('take-over');
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  async takeOver(projectId: string): Promise<number> {
    const result = await this.actions.run(
      this.takeOverAction,
      { projectId, ids: [...this.selected()] },
      { key: 'take-over' },
    );
    this.notifications.info('files.takeOver.done', { count: result.added });
    return result.added;
  }
}
