import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../core/actions/action';
import {
  type ActivityProgress,
  ActivityService,
} from '../../core/activity/activity.service';
import { ActionRunner } from '../../core/actions/action-runner';
import { apiUrl } from '../../core/api/api-url';
import type { EstvStatus } from '../../core/api/calculation.types';
import { NotificationService } from '../../core/notifications/notification.service';

/** How often a running update is polled. */
export const ESTV_POLL_MS = 1500;

/** Percent of the current phase, when the total is known. */
export function estvPercent(running: EstvStatus['running']): number | null {
  const progress = running?.progress;
  if (!progress?.totalBytes) return null;
  return Math.min(
    100,
    Math.floor((progress.bytes / progress.totalBytes) * 100),
  );
}

/**
 * The deployment's ESTV Kursliste (F7.4a), shared by Einstellungen › Kurse and a project's Kurse
 * tab: the status (versions per year, last check, errors) and "ESTV-Kursliste aktualisieren" —
 * the API starts the download in the background, this service polls until it is done and then
 * reports the outcome. While it runs, the app-wide activity indicator (`ActivityService`) shows
 * the phase and the download progress.
 */
@Injectable({ providedIn: 'root' })
export class EstvService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);
  private readonly notifications = inject(NotificationService);
  private readonly activity = inject(ActivityService);
  private readonly translate = inject(TranslateService);

  private readonly loadRequested = signal(false);
  private readonly loaded = httpResource<EstvStatus>(() =>
    this.loadRequested() ? apiUrl('/rates/estv') : undefined,
  );
  /** The newest status an update brought (wins over the loaded one). */
  private readonly pushed = signal<EstvStatus | null>(null);

  readonly status = computed<EstvStatus | null>(
    () =>
      this.pushed() ?? (this.loaded.hasValue() ? this.loaded.value() : null),
  );
  readonly loadFailed = computed(
    () => this.pushed() === null && this.loaded.error() !== undefined,
  );

  private readonly polling = signal(false);
  readonly running = computed(() => this.status()?.running ?? null);
  readonly isBusy = computed(() => this.polling() || this.running() !== null);
  readonly percent = computed(() => estvPercent(this.running()));

  private readonly startAction = defineAction<{ year?: number }, EstvStatus>({
    run: ({ year }) =>
      firstValueFrom(
        this.http.post<EstvStatus>(
          apiUrl('/rates/estv/update'),
          year === undefined ? {} : { year },
        ),
      ),
    messages: { error: 'estv.updateFailed' },
  });

  /** Loads the status (lazily, by the first page that shows it; again on later calls). */
  load(): void {
    this.pushed.set(null);
    if (this.loadRequested()) this.loaded.reload();
    else this.loadRequested.set(true);
  }

  /**
   * Starts the update (one year, or every stored year + last year), polls until it has finished
   * and reports this run's outcome: updated, current, or the error. Resolves with the final status.
   */
  async update(year?: number): Promise<EstvStatus> {
    // The app-wide activity indicator shows the run with its phase and download progress.
    return this.activity.track(
      'activity.estvUpdate',
      () => this.runUpdate(year),
      { params: this.activityParams, progress: this.activityProgress },
    );
  }

  private readonly activityParams = computed(() => {
    this.translate.currentLang(); // F11.2: re-translate on a language switch
    const running = this.running();
    return {
      year: running?.year ?? '',
      phase: running
        ? this.translate.instant(`estv.phase.${running.progress.phase}`)
        : '',
    };
  });

  private readonly activityProgress = computed<ActivityProgress | null>(() => {
    const percent = this.percent();
    return percent === null
      ? null
      : { done: percent, total: 100, asPercent: true };
  });

  private async runUpdate(year?: number): Promise<EstvStatus> {
    this.polling.set(true);
    try {
      let status = await this.actions.run(
        this.startAction,
        { year },
        { key: 'estv-update' },
      );
      this.pushed.set(status);
      const since = status.running?.startedAt;
      while (status.running) {
        await new Promise((resolve) => setTimeout(resolve, ESTV_POLL_MS));
        status = await firstValueFrom(
          this.http.get<EstvStatus>(apiUrl('/rates/estv')),
        );
        this.pushed.set(status);
      }
      this.report(status, year, since);
      return status;
    } finally {
      this.polling.set(false);
    }
  }

  /** The outcome of this run's checks (those made since it started). */
  private report(
    status: EstvStatus,
    year: number | undefined,
    since: string | undefined,
  ): void {
    const checked = status.years.filter(
      (y) =>
        (year === undefined || y.year === year) &&
        y.check !== null &&
        (since === undefined || y.check.checkedAt >= since),
    );
    const failed = checked.find((y) => y.check?.outcome === 'failed');
    if (failed) {
      this.notifications.error(
        'estv.checkFailed',
        failed.check?.error ?? undefined,
      );
      return;
    }
    if (checked.some((y) => y.check?.outcome === 'updated')) {
      this.notifications.success('estv.updated');
    } else {
      this.notifications.info('estv.current');
    }
  }
}
