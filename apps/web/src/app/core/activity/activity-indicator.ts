import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronDown,
  lucideChevronUp,
  lucideLoaderCircle,
} from '@ng-icons/lucide';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ActivityService, type ActivityTask } from './activity.service';

/**
 * The app-wide activity indicator (UI rule: every action that can take more than ~1 s goes
 * through `ActivityService`): a small snackbar at the bottom right with a spinner, the running
 * task's label and progress; with several tasks "3 Aufgaben laufen", expandable to the list.
 * Rendered once in the root component, above dialogs and toasts, so it stays while navigating.
 * The live region is always in the DOM (`role="status"`); the spinner is decorative.
 */
@Component({
  selector: 'lk-activity-indicator',
  imports: [NgIcon, TranslatePipe],
  providers: [
    provideIcons({ lucideLoaderCircle, lucideChevronDown, lucideChevronUp }),
  ],
  templateUrl: './activity-indicator.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityIndicator {
  protected readonly activity = inject(ActivityService);
  private readonly translate = inject(TranslateService);
  protected readonly expanded = signal(false);

  protected readonly single = computed<ActivityTask | null>(() => {
    const tasks = this.activity.tasks();
    return tasks.length === 1 ? (tasks[0] ?? null) : null;
  });

  /** "Kurse werden aktualisiert (12/40) …" — label, progress when known, ellipsis. */
  protected text(task: ActivityTask): string {
    const label = this.translate.instant(task.label, task.params());
    const progress = task.progress();
    if (progress?.asPercent) {
      return this.translate.instant('activity.withPercent', {
        label,
        percent: this.percent(task) ?? 0,
      });
    }
    return progress
      ? this.translate.instant('activity.withProgress', {
          label,
          done: progress.done,
          total: progress.total,
        })
      : this.translate.instant('activity.running', { label });
  }

  protected percent(task: ActivityTask): number | null {
    const progress = task.progress();
    if (!progress || progress.total <= 0) return null;
    return Math.round((progress.done / progress.total) * 100);
  }
}
