import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideArrowRight,
  lucideCheck,
  lucideCircleAlert,
  lucideCircleMinus,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmSkeletonImports } from '@lazykoins/ui/skeleton';
import type { SetupStepId } from '../../../../core/api/setup.types';
import { EmptyState } from '../../../../shared/components/empty-state';
import { HelpLink } from '../../../help/components/help-link';
import { PageHeader } from '../../../../shared/components/page-header';
import { SetupStepComponent } from '../../components/setup-step';
import { AdvisorStep } from '../../components/steps/advisor-step';
import { AiStep } from '../../components/steps/ai-step';
import { MailStep } from '../../components/steps/mail-step';
import { PinStep } from '../../components/steps/pin-step';
import { ProfileStep } from '../../components/steps/profile-step';
import { RatesStep } from '../../components/steps/rates-step';
import { StorageStep } from '../../components/steps/storage-step';
import { SummaryStep } from '../../components/steps/summary-step';
import { WalletsStep } from '../../components/steps/wallets-step';
import { SetupPageService } from './setup-page.service';

/**
 * The setup wizard (F11.0s) — `/app/setup`, `?step=<id>` opens a step directly (deep links from
 * features that lack configuration). A step bar with number, title and state; the current step in
 * a card; Zurück / Später / Weiter fixed at the bottom. Every step reuses the settings' forms and
 * endpoints; the page only moves between them.
 */
@Component({
  selector: 'lk-setup-page',
  imports: [
    NgIcon,
    TranslatePipe,
    PageHeader,
    HelpLink,
    EmptyState,
    ProfileStep,
    AdvisorStep,
    AiStep,
    RatesStep,
    WalletsStep,
    MailStep,
    StorageStep,
    PinStep,
    SummaryStep,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmSkeletonImports,
  ],
  providers: [
    SetupPageService,
    provideIcons({
      lucideArrowLeft,
      lucideArrowRight,
      lucideCheck,
      lucideCircleAlert,
      lucideCircleMinus,
    }),
  ],
  templateUrl: './setup-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupPage {
  /** `?step=ai` — bound from the query (no default: an absent param binds as undefined). */
  readonly step = input<string>();
  protected readonly service = inject(SetupPageService);
  private readonly stepComponent = viewChild(SetupStepComponent);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('stepHeading');

  constructor() {
    effect(() => {
      const requested = this.step();
      untracked(() => void this.service.init(requested ?? null));
    });
    // Moving to another step puts the focus on its title (keyboard and screen readers).
    effect(() => {
      this.service.current();
      untracked(() =>
        queueMicrotask(() => this.heading()?.nativeElement.focus()),
      );
    });
  }

  protected next(): void {
    void this.service.next(this.stepComponent());
  }

  protected goTo(id: SetupStepId): void {
    this.service.goTo(id);
  }
}
