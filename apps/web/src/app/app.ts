import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmToasterImports } from '@lazykoins/ui/sonner';
import { ActivityIndicator } from './core/activity/activity-indicator';
import { ActivityService } from './core/activity/activity.service';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'lk-root',
  imports: [RouterOutlet, ActivityIndicator, ...HlmToasterImports],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly theme = inject(ThemeService);
  /** While a task runs, the toasts stack above the activity indicator (`lk-toasts-raised`). */
  protected readonly activity = inject(ActivityService);
  protected readonly toasterTheme = computed(() => this.theme.current());
}
