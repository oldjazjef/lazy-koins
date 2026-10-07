import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  ATTRIBUTION_URLS,
  attributionsFor,
} from '../../../core/api/price-sources.types';

/**
 * The attribution CoinGecko's and CoinMarketCap's terms require wherever their data is shown
 * (price sources phase 2): "Kursdaten: Data provided by CoinGecko · …", each linked to the
 * provider. Renders nothing when none of `sources` needs one.
 */
@Component({
  selector: 'lk-price-attribution',
  imports: [TranslatePipe],
  template: `
    @if (credits().length > 0) {
      <p class="text-muted-foreground text-xs" role="note">
        {{ 'rates.attribution.label' | translate }}:
        @for (credit of credits(); track credit.id; let last = $last) {
          <a
            class="hover:underline"
            [href]="credit.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ 'rates.attribution.' + credit.id | translate }}</a
          >{{ last ? '' : ' · ' }}
        }
      </p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceAttribution {
  /** Price sources shown nearby (`coingecko`, `binance`, …). */
  readonly sources = input.required<readonly (string | null | undefined)[]>();

  protected readonly credits = computed(() =>
    attributionsFor(this.sources()).map((id) => ({
      id,
      url: ATTRIBUTION_URLS[id],
    })),
  );
}
