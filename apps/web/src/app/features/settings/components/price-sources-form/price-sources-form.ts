import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadgeImports } from '@lazykoins/ui/badge';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import type {
  PriceProviderId,
  PriceSourceView,
} from '../../../../core/api/price-sources.types';
import { PriceSourcesService } from '../../price-sources.service';

/** Moves the item at `index` one place up (`-1`) or down (`+1`); out of range = unchanged. */
export function moveProvider<T>(
  list: readonly T[],
  index: number,
  step: -1 | 1,
): T[] {
  const target = index + step;
  if (index < 0 || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

/**
 * Price sources (F7.4, phase 2): the crypto price providers in the order they are asked — on/off,
 * up/down — with what each offers (key, history depth on the free tier, USD only, personal use
 * only, attribution), the CoinMarketCap key and "Testen" per provider (plan, history depth, the
 * error and the provider's words). Shared by Einstellungen › Kurse and the setup wizard
 * (`compact`: no details; `embedded`: no save button — "Weiter" calls `submit()`).
 */
@Component({
  selector: 'lk-price-sources-form',
  imports: [
    NgIcon,
    TranslatePipe,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp })],
  templateUrl: './price-sources-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceSourcesForm {
  readonly embedded = input(false);
  readonly compact = input(false);
  protected readonly service = inject(PriceSourcesService);

  /** The order on screen (edited locally until saved). */
  protected readonly order = signal<PriceSourceView[]>([]);
  protected readonly dirty = signal(false);
  /** The CoinMarketCap key typed (sent once on save, never shown again). */
  protected readonly cmcKey = signal('');
  protected readonly keyStorage = computed(
    () =>
      !this.service.sources.hasValue() ||
      this.service.sources.value().keyStorageAvailable,
  );
  protected readonly cmc = computed(() =>
    this.order().find((p) => p.id === 'coinmarketcap'),
  );

  constructor() {
    effect(() => {
      if (!this.service.sources.hasValue() || this.dirty()) return;
      this.order.set(this.service.sources.value().providers);
    });
  }

  protected toggle(id: PriceProviderId, enabled: boolean): void {
    this.order.update((list) =>
      list.map((p) => (p.id === id ? { ...p, enabled } : p)),
    );
    this.dirty.set(true);
  }

  protected move(index: number, step: -1 | 1): void {
    this.order.update((list) => moveProvider(list, index, step));
    this.dirty.set(true);
  }

  protected typeKey(event: Event): void {
    this.cmcKey.set((event.target as HTMLInputElement).value);
  }

  protected quotesUsdOnly(provider: PriceSourceView): boolean {
    return (
      provider.quotes !== 'anyFiat' &&
      provider.quotes.length === 1 &&
      provider.quotes[0] === 'USD'
    );
  }

  /** "Testen": the typed CoinMarketCap key for CMC (never stored), else the stored key. */
  protected test(id: PriceProviderId): void {
    void this.service.test(
      id,
      id === 'coinmarketcap' ? this.cmcKey() : undefined,
    );
  }

  protected removeKey(): void {
    void this.service
      .save(this.order(), { coinmarketcapKey: null })
      .catch(() => undefined);
  }

  /** Saves order and a typed key; true when saved or nothing changed. */
  async submit(): Promise<boolean> {
    const key = this.cmcKey().trim();
    if (!this.dirty() && key === '') return true;
    try {
      await this.service.save(this.order(), {
        ...(key ? { coinmarketcapKey: key } : {}),
        quiet: this.embedded(),
      });
      this.dirty.set(false);
      this.cmcKey.set('');
      return true;
    } catch {
      return false;
    }
  }

  protected save(): void {
    void this.submit();
  }
}
