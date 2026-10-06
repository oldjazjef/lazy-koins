import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { apiUrl } from '../../../../core/api/api-url';
import type {
  CreateFollowUpRequest,
  FollowUpOptions,
} from '../../../../core/api/dashboard.types';

export type SelectionGroup = 'files' | 'wallets' | 'corrections' | 'openItems';

/**
 * F4.4a "Folgeprojekt erstellen": what the project can hand on (the API decides what is
 * offered and what is preselected), the user's choice per group, and the creation — one
 * request, one transaction in the API; then the new project opens.
 */
@Injectable()
export class FollowUpPageService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly actions = inject(ActionRunner);

  readonly projectId = signal<string | undefined>(undefined);

  readonly options = httpResource<FollowUpOptions>(() => {
    const id = this.projectId();
    return id ? apiUrl(`/projects/${id}/follow-up`) : undefined;
  });

  readonly selected = signal<
    Readonly<Record<SelectionGroup, ReadonlySet<string>>>
  >({
    files: new Set(),
    wallets: new Set(),
    corrections: new Set(),
    openItems: new Set(),
  });
  readonly takeNotes = signal(true);

  /** All ids of a group, as offered. */
  idsOf(group: SelectionGroup): string[] {
    if (!this.options.hasValue()) return [];
    const options = this.options.value();
    if (group === 'files') return options.files.map((f) => f.projectFileId);
    if (group === 'wallets') {
      return (options.wallets ?? []).map((w) => w.walletId);
    }
    if (group === 'corrections') return options.corrections.map((c) => c.id);
    return options.openItems.map((o) => o.key);
  }

  /** The API's preselection: files reaching into the new year and every wallet. */
  preselect(options: FollowUpOptions): void {
    this.selected.set({
      files: new Set(
        options.files.filter((f) => f.preselected).map((f) => f.projectFileId),
      ),
      wallets: new Set(
        (options.wallets ?? [])
          .filter((w) => w.preselected)
          .map((w) => w.walletId),
      ),
      corrections: new Set(),
      openItems: new Set(),
    });
    this.takeNotes.set(options.notes.trim() !== '');
  }

  isSelected(group: SelectionGroup, id: string): boolean {
    return this.selected()[group].has(id);
  }

  toggle(group: SelectionGroup, id: string): void {
    this.selected.update((current) => {
      const next = new Set(current[group]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [group]: next };
    });
  }

  setAll(group: SelectionGroup, all: boolean): void {
    this.selected.update((current) => ({
      ...current,
      [group]: new Set(all ? this.idsOf(group) : []),
    }));
  }

  readonly summary = computed(() => ({
    files: this.selected().files.size,
    wallets: this.selected().wallets.size,
    corrections: this.selected().corrections.size,
    openItems: this.selected().openItems.size,
    notes: this.takeNotes(),
  }));

  private readonly createAction = defineAction<
    { id: string; request: CreateFollowUpRequest },
    { projectId: string }
  >({
    run: ({ id, request }) =>
      firstValueFrom(
        this.http.post<{ projectId: string }>(
          apiUrl(`/projects/${id}/follow-up`),
          request,
        ),
      ),
    messages: {
      success: 'projects.followUp.created',
      error: 'projects.followUp.createFailed',
    },
  });

  private readonly status = this.actions.status<unknown>('follow-up');
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  async create(facts: {
    name: string;
    taxYear: number;
    canton: string;
  }): Promise<void> {
    const id = this.projectId();
    if (!id) return;
    const selected = this.selected();
    const { projectId } = await this.actions.run(
      this.createAction,
      {
        id,
        request: {
          ...facts,
          fileIds: [...selected.files],
          correctionIds: [...selected.corrections],
          openItemKeys: [...selected.openItems],
          notes: this.takeNotes(),
          walletIds: [...selected.wallets],
        },
      },
      { key: 'follow-up' },
    );
    await this.router.navigate(['/app/projects', projectId], {
      replaceUrl: true,
    });
  }
}
