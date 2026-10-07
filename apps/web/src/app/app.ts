import { AiErrorDialog } from './shared/ai/ai-error-dialog';
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
import { AuthService } from './core/auth/auth.service';
import { LockScreen } from './core/pin/lock-screen/lock-screen';
import { PinLockService } from './core/pin/pin-lock.service';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'lk-root',
  imports: [
    RouterOutlet,
    ActivityIndicator,
    LockScreen,
    AiErrorDialog,
    ...HlmToasterImports,
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly pin = inject(PinLockService);
  /** While a task runs, the toasts stack above the activity indicator (`lk-toasts-raised`). */
  protected readonly activity = inject(ActivityService);
  protected readonly toasterTheme = computed(() => this.theme.current());
  /** F11.0p: the lock screen covers the app while signed in and locked. */
  protected readonly showLock = computed(
    () => this.auth.isSignedIn() && this.pin.locked(),
  );
}
