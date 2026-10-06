import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AiSettingsForm } from '../../../settings/components/ai-settings-form/ai-settings-form';
import { AiSettingsPageService } from '../../../settings/pages/ai-settings-page/ai-settings-page.service';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/**
 * AI-Plugin (F5.13, F5.14, optional — "ohne AI fortfahren" = Später): the settings' own form with
 * presets, key, "Verbindung testen" and its error panel, plus the consent to send file excerpts
 * (the app still shows what is sent before every request).
 */
@Component({
  selector: 'lk-setup-ai-step',
  imports: [TranslatePipe, AiSettingsForm],
  providers: [provideSetupStep(() => AiStep)],
  template: `
    <div class="flex flex-col gap-6">
      <lk-ai-settings-form [embedded]="true" />
      <div class="lk-panel flex flex-col gap-2 p-4">
        <h3 class="text-sm font-semibold">
          {{ 'settings.ai.consent.title' | translate }}
        </h3>
        <p class="text-muted-foreground text-sm">
          {{ 'settings.ai.consent.body' | translate }}
        </p>
        @if (consentGiven()) {
          <p class="text-sm" role="status">
            {{ 'setup.ai.consentGiven' | translate }}
          </p>
        } @else {
          <label class="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              class="mt-1"
              [checked]="consent()"
              (change)="consent.set($any($event.target).checked)"
            />
            {{ 'setup.ai.consent' | translate }}
          </label>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiStep extends SetupStepComponent {
  private readonly service = inject(AiSettingsPageService);
  private readonly form = viewChild.required(AiSettingsForm);
  protected readonly consent = signal(false);
  protected readonly consentGiven = computed(
    () =>
      this.service.settings.hasValue() &&
      this.service.settings.value().consentAt !== null,
  );

  submit(): Promise<boolean> {
    return this.form().submit(
      this.consent() && !this.consentGiven() ? { giveConsent: true } : {},
    );
  }
}
