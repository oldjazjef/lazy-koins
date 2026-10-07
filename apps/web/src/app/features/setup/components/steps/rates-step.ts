import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { EstvService } from '../../../../shared/estv/estv.service';
import { RatesKeyForm } from '../../../settings/components/rates-key-form/rates-key-form';
import { PriceSourcesForm } from '../../../settings/components/price-sources-form/price-sources-form';
import { provideSetupStep, SetupStepComponent } from '../setup-step';

/**
 * Kurse (F11.3, F6.7, F7.4a, optional): rate lookups on/off and the CoinGecko key with "Testen"
 * (the settings' own form), the price providers compact (order, on/off, CoinMarketCap key), and whether the ESTV Kursliste is fetched automatically — with
 * "Jetzt aktualisieren".
 */
@Component({
  selector: 'lk-setup-rates-step',
  imports: [TranslatePipe, RatesKeyForm, PriceSourcesForm, ...HlmButtonImports],
  providers: [provideSetupStep(() => RatesStep)],
  template: `
    <div class="flex flex-col gap-6">
      <lk-rates-key-form [embedded]="true" />
      <div class="lk-panel flex flex-col gap-2 p-4">
        <h3 class="text-sm font-semibold">
          {{ 'settings.priceSources.title' | translate }}
        </h3>
        <lk-price-sources-form [embedded]="true" [compact]="true" />
      </div>
      <div class="lk-panel flex flex-col gap-2 p-4">
        <h3 class="text-sm font-semibold">{{ 'estv.title' | translate }}</h3>
        <p class="text-muted-foreground text-sm">
          {{ 'estv.hint' | translate }}
        </p>
        @if (estv.status(); as status) {
          <p class="text-sm" role="status">
            @if (!status.autoEnabled) {
              {{ 'estv.disabled' | translate }}
            } @else if (!status.online) {
              {{ 'estv.offline' | translate }}
            } @else if (latest(); as year) {
              {{ 'setup.rates.estvLoaded' | translate: { year: year } }}
            } @else {
              {{ 'setup.rates.estvAuto' | translate }}
            }
          </p>
          @if (estv.running(); as running) {
            <p class="text-sm" aria-live="polite">
              {{ 'estv.running' | translate: { year: running.year } }} ·
              {{ 'estv.phase.' + running.progress.phase | translate }}
            </p>
          }
          <div>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              type="button"
              [disabled]="
                !status.autoEnabled || !status.online || estv.isBusy()
              "
              (click)="update()"
            >
              {{ 'estv.update' | translate }}
            </button>
          </div>
        } @else if (estv.loadFailed()) {
          <p class="text-destructive text-sm">
            {{ 'estv.loadFailed' | translate }}
          </p>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RatesStep extends SetupStepComponent {
  protected readonly estv = inject(EstvService);
  private readonly form = viewChild.required(RatesKeyForm);
  private readonly sources = viewChild.required(PriceSourcesForm);

  /** The newest tax year with a downloaded Kursliste. */
  protected readonly latest = computed(() => {
    const years = (this.estv.status()?.years ?? [])
      .filter((row) => row.version !== null)
      .map((row) => row.year);
    return years.length > 0 ? Math.max(...years) : null;
  });

  constructor() {
    super();
    this.estv.load();
  }

  protected update(): void {
    void this.estv.update().catch(() => undefined);
  }

  async submit(): Promise<boolean> {
    return (await this.form().submit()) && (await this.sources().submit());
  }
}
