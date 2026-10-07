import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../../../../core/api/api-url';
import {
  SETUP_STEPS,
  type SetupStep,
  type SetupStepId,
  type SetupView,
  type StepState,
  type UpdateSetupRequest,
} from '../../../../core/api/setup.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { SetupStateService } from '../../../../core/setup/setup-state.service';
import type { SetupStepComponent } from '../../components/setup-step';

/** Where "Erstes Projekt anlegen" and "App starten" go. */
export const FINISH_TARGETS = {
  app: '/app/dashboard',
  project: '/app/projects/new',
} as const;

/**
 * The setup wizard (F11.0s): which step is on screen, which ones may be opened (visited ones),
 * "Weiter" (the step validates and saves itself, then the state is stored), "Später" (optional
 * steps only), "Zurück", deep links (`/app/setup?step=ai`) and "App starten". The progress lives
 * in the API (`/api/setup`), so a closed wizard opens again where it was left.
 */
@Injectable()
export class SetupPageService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly state = inject(SetupStateService);

  readonly view = this.state.view;
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly busy = signal(false);
  readonly current = signal<SetupStepId>('profile');
  private readonly visited = signal<ReadonlySet<SetupStepId>>(new Set());

  readonly steps = computed<SetupStep[]>(() => this.view()?.steps ?? []);
  readonly index = computed(() =>
    this.steps().findIndex((step) => step.id === this.current()),
  );
  readonly step = computed(() => this.steps()[this.index()]);
  readonly isFirst = computed(() => this.index() <= 0);
  readonly isSummary = computed(() => this.current() === 'summary');
  readonly canSkip = computed(() => {
    const step = this.step();
    return step !== undefined && !step.required && step.id !== 'summary';
  });

  /** Loads the progress and opens `requested` (a deep link), else where the user left off. */
  async init(requested?: string | null): Promise<void> {
    this.loading.set(true);
    const view = await this.state.load(true);
    this.loading.set(false);
    if (!view) {
      this.loadFailed.set(true);
      return;
    }
    this.loadFailed.set(false);
    const ids = view.steps.map((step) => step.id);
    const start =
      requested && (ids as string[]).includes(requested)
        ? (requested as SetupStepId)
        : ids.includes(view.currentStep)
          ? view.currentStep
          : (ids[0] ?? 'profile');
    // Every step with a state is "visited", and everything up to where the user left off.
    const until = Math.max(ids.indexOf(view.currentStep), ids.indexOf(start));
    this.visited.set(
      new Set(
        view.steps
          .filter((step, i) => step.state !== 'open' || i <= until)
          .map((step) => step.id),
      ),
    );
    this.current.set(start);
    if (start !== view.currentStep) void this.patch({ currentStep: start });
  }

  /** Visited steps (and the current one) may be opened from the step bar. */
  canVisit(id: SetupStepId): boolean {
    return id === this.current() || this.visited().has(id);
  }

  goTo(id: SetupStepId): void {
    if (!this.canVisit(id) || id === this.current()) return;
    this.open(id);
  }

  back(): void {
    const previous = this.steps()[this.index() - 1];
    if (previous) this.open(previous.id);
  }

  /** "Weiter": the step validates and saves; then it is `done` and the next one opens. */
  async next(step: SetupStepComponent | undefined): Promise<boolean> {
    const current = this.step();
    if (!current || this.busy()) return false;
    this.busy.set(true);
    try {
      const ok = step ? await step.submit() : true;
      if (!ok) {
        await this.patch({ states: { [current.id]: 'error' } });
        return false;
      }
      const following = this.steps()[this.index() + 1];
      const saved = await this.patch(
        {
          states: { [current.id]: 'done' as StepState },
          ...(following ? { currentStep: following.id } : {}),
        },
        true,
      );
      if (!saved) {
        await this.patch({ states: { [current.id]: 'error' } });
        return false;
      }
      if (following) this.open(following.id, false);
      return true;
    } finally {
      this.busy.set(false);
    }
  }

  /** "Später" (optional steps): skipped, the next one opens. */
  async skip(): Promise<void> {
    const current = this.step();
    if (!current || !this.canSkip() || this.busy()) return;
    const following = this.steps()[this.index() + 1];
    this.busy.set(true);
    try {
      await this.patch({
        states: { [current.id]: 'skipped' },
        ...(following ? { currentStep: following.id } : {}),
      });
      if (following) this.open(following.id, false);
    } finally {
      this.busy.set(false);
    }
  }

  /** "App starten" / "Erstes Projekt anlegen": the wizard is finished. */
  async finish(target: keyof typeof FINISH_TARGETS): Promise<boolean> {
    this.busy.set(true);
    try {
      const view = await firstValueFrom(
        this.http.post<SetupView>(apiUrl('/setup/complete'), null),
      );
      this.state.set(view);
      await this.router.navigateByUrl(FINISH_TARGETS[target]);
      return true;
    } catch (error) {
      const missing = missingOf(error);
      this.notifications.error('setup.finishFailed');
      if (missing[0]) this.open(missing[0]);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private open(id: SetupStepId, store = true): void {
    this.current.set(id);
    this.visited.update((visited) => new Set([...visited, id]));
    if (store) void this.patch({ currentStep: id });
  }

  /** Stores step states / the current step; shows the API's reason when it refuses. */
  private async patch(
    request: UpdateSetupRequest,
    report = false,
  ): Promise<boolean> {
    try {
      this.state.set(
        await firstValueFrom(
          this.http.patch<SetupView>(apiUrl('/setup'), request),
        ),
      );
      return true;
    } catch (error) {
      if (report) {
        const code =
          error instanceof HttpErrorResponse
            ? (error.error as { code?: unknown } | null)?.code
            : undefined;
        this.notifications.error(
          code === 'stepIncomplete'
            ? 'setup.stepIncomplete'
            : 'setup.saveFailed',
        );
      }
      return false;
    }
  }
}

function missingOf(error: unknown): SetupStepId[] {
  if (!(error instanceof HttpErrorResponse)) return [];
  const missing = (error.error as { missing?: unknown } | null)?.missing;
  return Array.isArray(missing)
    ? missing.filter((id): id is SetupStepId =>
        (SETUP_STEPS as readonly unknown[]).includes(id),
      )
    : [];
}
