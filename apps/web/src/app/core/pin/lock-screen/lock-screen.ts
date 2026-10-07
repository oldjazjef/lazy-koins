import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideDelete,
  lucideLock,
  lucideLogOut,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { LockScreenService } from './lock-screen.service';

/** The pad's rows: digits, then delete · 0 · unlock. */
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * The PIN lock screen (F11.0p): full screen over the app (which is `inert` meanwhile), the logo,
 * the PIN as a field and as a pad, the error with the remaining wait, "PIN vergessen" and — on
 * the web — sign out. Opened by `PinLockService.locked()` in the app root.
 */
@Component({
  selector: 'lk-lock-screen',
  imports: [
    NgIcon,
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [
    LockScreenService,
    provideIcons({ lucideCircleAlert, lucideDelete, lucideLock, lucideLogOut }),
  ],
  templateUrl: './lock-screen.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LockScreen {
  protected readonly screen = inject(LockScreenService);
  protected readonly pad = PAD;
  // A template literal: i18n-keys.spec.ts reads quoted dotted literals as translation keys.
  protected readonly logo = `favicon.svg`;
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('pinInput');

  constructor() {
    void this.screen.open();
    afterNextRender(() => this.focus());
  }

  protected typed(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.screen.typed(target.value);
    target.value = this.screen.value();
  }

  protected async submit(): Promise<void> {
    await this.screen.submit();
    this.focus();
  }

  protected press(digit: string): void {
    this.screen.press(digit);
    this.focus();
  }

  protected backspace(): void {
    this.screen.backspace();
    this.focus();
  }

  private focus(): void {
    this.input()?.nativeElement.focus();
  }
}
