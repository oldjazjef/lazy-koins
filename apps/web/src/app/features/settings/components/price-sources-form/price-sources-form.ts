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
import {
  isKeyedProvider,
  type KeyedProvider,
  type PriceProviderId,
  type PriceSourceView,
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
 * only, attribution) and "Testen" per provider (plan, history depth, the error and the provider's
 * words). Providers with a key (CoinGecko optional, CoinMarketCap required) take it right in their
 * row (user request 07.10.2026) — typed, tested and saved there. Shared by Einstellungen › Kurse and the setup wizard
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
  /** Keys typed per provider (sent once on save, never shown again). */
  protected readonly typedKeys = signal<Partial<Record<KeyedProvider, string>>>(
    {},
  );
  protected readonly isKeyed = isKeyedProvider;
  protected readonly keyStorage = computed(
    () =>
      !this.service.sources.hasValue() ||
      this.service.sources.value().keyStorageAvailable,
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

  protected typedKey(id: PriceProviderId): string {
    return isKeyedProvider(id) ? (this.typedKeys()[id] ?? '') : '';
  }

  protected typeKey(id: PriceProviderId, event: Event): void {
    if (!isKeyedProvider(id)) return;
    const value = (event.target as HTMLInputElement).value;
    this.typedKeys.update((keys) => ({ ...keys, [id]: value }));
  }

  /** Typed keys that are not blank — what a save sends. */
  private keysToSave(): Partial<Record<KeyedProvider, string>> {
    return Object.fromEntries(
      Object.entries(this.typedKeys())
        .map(([id, key]) => [id, key.trim()] as const)
        .filter(([, key]) => key !== ''),
    );
  }

  protected readonly hasTypedKey = computed(
    () => Object.keys(this.keysToSave()).length > 0,
  );

  protected quotesUsdOnly(provider: PriceSourceView): boolean {
    return (
      provider.quotes !== 'anyFiat' &&
      provider.quotes.length === 1 &&
      provider.quotes[0] === 'USD'
    );
  }

  /** "Testen": the key typed in the row (never stored), else the stored one (CoinGecko without = public API). */
  protected test(id: PriceProviderId): void {
    void this.service.test(id, this.typedKey(id) || undefined);
  }

  protected removeKey(id: PriceProviderId): void {
    if (!isKeyedProvider(id)) return;
    void this.service
      .save(this.order(), { keys: { [id]: null } })
      .catch(() => undefined);
  }

  /** Saves order and typed keys; true when saved or nothing changed. */
  async submit(): Promise<boolean> {
    const keys = this.keysToSave();
    if (!this.dirty() && Object.keys(keys).length === 0) return true;
    try {
      await this.service.save(this.order(), {
        keys,
        quiet: this.embedded(),
      });
      this.dirty.set(false);
      this.typedKeys.set({});
      return true;
    } catch {
      return false;
    }
  }

  protected save(): void {
    void this.submit();
  }
}
