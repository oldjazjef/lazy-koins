import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmDialogImports } from '@lazykoins/ui/dialog';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { extractErrorDetail } from '../../core/actions/extract-error-detail';
import type { ErrorText } from '../../core/api/api-error';
import {
  type CoinCandidate,
  type CoinChoice,
  COIN_PROVIDERS,
  type CoinProvider,
} from '../../core/api/coin.types';
import { CoinsService } from './coins.service';

/** What the picker hands back: the ticker and the coin chosen for it. */
export interface PickedCoin {
  readonly symbol: string;
  readonly provider: CoinProvider;
  readonly id: string;
}

const SYMBOL = /^[A-Za-z0-9.]{1,40}$/;

/**
 * F7.4 "Coin wählen": a dialog that searches the price provider's coins by symbol, name or id and
 * shows each with name, symbol and market-cap rank (the built-in suggestion marked), so the user
 * sees which coin they pick instead of typing an id blind. Open while `symbol` is not null;
 * `editableSymbol` lets the settings page enter a new ticker. The host stores the pick.
 */
@Component({
  selector: 'lk-coin-picker',
  imports: [
    TranslatePipe,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  templateUrl: './coin-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoinPicker {
  private readonly coins = inject(CoinsService);

  /** The ticker to choose a coin for; `null` = closed. */
  readonly symbol = input<string | null>(null);
  /** The coin chosen now (marked in the list). */
  readonly current = input<CoinChoice | null>(null);
  readonly editableSymbol = input(false);
  readonly busy = input(false);

  readonly picked = output<PickedCoin>();
  readonly closed = output<void>();

  /** Price sources phase 2: the provider to search (CoinGecko, CoinMarketCap with its key). */
  protected readonly providers = COIN_PROVIDERS;
  protected readonly provider = signal<CoinProvider>('coingecko');
  protected readonly ticker = signal('');
  protected readonly query = signal('');
  protected readonly results = signal<readonly CoinCandidate[]>([]);
  protected readonly suggested = signal<string | null>(null);
  protected readonly ambiguous = signal(false);
  protected readonly searching = signal(false);
  protected readonly searched = signal(false);
  protected readonly error = signal<ErrorText | null>(null);
  protected readonly selected = signal<CoinCandidate | null>(null);

  protected readonly state = computed(() =>
    this.symbol() === null ? 'closed' : 'open',
  );
  protected readonly tickerValid = computed(() =>
    SYMBOL.test(this.ticker().trim()),
  );

  constructor() {
    // Every opening starts fresh with a search for the ticker.
    effect(() => {
      const symbol = this.symbol();
      if (symbol === null) return;
      untracked(() => {
        this.provider.set(this.current()?.provider ?? 'coingecko');
        this.ticker.set(symbol);
        this.query.set(symbol);
        this.results.set([]);
        this.selected.set(null);
        this.error.set(null);
        this.searched.set(false);
        if (symbol) void this.search();
      });
    });
  }

  protected setTicker(event: Event): void {
    this.ticker.set((event.target as HTMLInputElement).value.toUpperCase());
  }

  protected setProvider(event: Event): void {
    this.provider.set(
      (event.target as HTMLSelectElement).value as CoinProvider,
    );
    this.results.set([]);
    this.selected.set(null);
    if (this.query().trim()) void this.search();
  }

  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  async search(): Promise<void> {
    const q = this.query().trim();
    if (!q) return;
    this.searching.set(true);
    this.error.set(null);
    try {
      const answer = await this.coins.search(q, this.provider());
      this.results.set(answer.coins);
      this.suggested.set(answer.suggested);
      this.ambiguous.set(answer.ambiguous);
      this.searched.set(true);
      const current = this.current();
      const preselect =
        answer.coins.find((c) => c.id === current?.id) ??
        (answer.coins.length === 1 ? answer.coins[0] : undefined);
      this.selected.set(preselect ?? null);
    } catch (error) {
      this.results.set([]);
      this.error.set(
        extractErrorDetail(error) ?? { key: 'coins.searchFailed' },
      );
    } finally {
      this.searching.set(false);
    }
  }

  protected select(coin: CoinCandidate): void {
    this.selected.set(coin);
  }

  protected confirm(): void {
    const coin = this.selected();
    const symbol = this.ticker().trim().toUpperCase();
    if (!coin || !SYMBOL.test(symbol)) return;
    this.picked.emit({ symbol, provider: coin.provider, id: coin.id });
  }

  protected changed(state: 'open' | 'closed'): void {
    if (state === 'closed') this.closed.emit();
  }
}
