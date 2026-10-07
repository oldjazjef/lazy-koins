import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { defineAction } from '../../core/actions/action';
import { ActionRunner } from '../../core/actions/action-runner';
import { apiUrl } from '../../core/api/api-url';
import type {
  ChooseCoinResult,
  CoinCandidate,
  CoinChoiceResult,
  CoinProvider,
  CoinSearch,
} from '../../core/api/coin.types';

/** A coin to store: provider + id (the API validates it and keeps its name). */
export interface CoinRef {
  readonly provider: CoinProvider;
  readonly id: string;
}

/**
 * F7.4 "Coin wählen", shared by Einstellungen › Kurse, the project's Kurse tab and the dashboard:
 * search the provider's coins, store the coin of a ticker (the API removes the asset's fetched
 * prices everywhere), choose it from a project (+ refetch of that asset). Every change reaches
 * the views through the data-refresh interceptor (`settings/coins`, `…/rates/coin`).
 */
@Injectable({ providedIn: 'root' })
export class CoinsService {
  private readonly http = inject(HttpClient);
  private readonly actions = inject(ActionRunner);

  /** The provider's coins for a symbol, name or id (a read; errors go to the caller). */
  search(
    query: string,
    provider: CoinProvider = 'coingecko',
  ): Promise<CoinSearch> {
    return firstValueFrom(
      this.http.get<CoinSearch>(apiUrl('/rates/coins/search'), {
        params: new HttpParams().set('provider', provider).set('q', query),
      }),
    );
  }

  /** "ID prüfen": the coin behind an id — 422 `unknownCoin` when the provider has none. */
  lookup(
    id: string,
    provider: CoinProvider = 'coingecko',
  ): Promise<CoinCandidate> {
    return firstValueFrom(
      this.http.get<CoinCandidate>(
        apiUrl(
          `/rates/coins/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`,
        ),
      ),
    );
  }

  private readonly setAction = defineAction<
    { symbol: string; coin: CoinRef },
    CoinChoiceResult
  >({
    run: ({ symbol, coin }) =>
      firstValueFrom(
        this.http.put<CoinChoiceResult>(
          apiUrl(`/settings/coins/${encodeURIComponent(symbol)}`),
          coin,
        ),
      ),
    messages: { success: 'coins.saved', error: 'coins.saveFailed' },
  });

  private readonly removeAction = defineAction<string, CoinChoiceResult>({
    run: (symbol) =>
      firstValueFrom(
        this.http.delete<CoinChoiceResult>(
          apiUrl(`/settings/coins/${encodeURIComponent(symbol)}`),
        ),
      ),
    messages: { success: 'coins.removed', error: 'coins.removeFailed' },
  });

  private readonly chooseAction = defineAction<
    { projectId: string; asset: string; coin: CoinRef },
    ChooseCoinResult
  >({
    run: ({ projectId, asset, coin }) =>
      firstValueFrom(
        this.http.post<ChooseCoinResult>(
          apiUrl(`/projects/${projectId}/rates/coin`),
          { asset, ...coin },
        ),
      ),
    messages: { success: 'coins.chosen', error: 'coins.saveFailed' },
  });

  private readonly dismissAction = defineAction<
    { symbol: string; dismissed: boolean },
    { dismissed: string[] }
  >({
    run: ({ symbol, dismissed }) => {
      const url = apiUrl(
        `/settings/coins/${encodeURIComponent(symbol)}/dismissal`,
      );
      return firstValueFrom(
        dismissed
          ? this.http.put<{ dismissed: string[] }>(url, {})
          : this.http.delete<{ dismissed: string[] }>(url),
      );
    },
    messages: { error: 'coins.saveFailed' },
  });

  /** "Passt so" for a shared-code warning (`false` = warn again). */
  dismiss(symbol: string, dismissed = true): Promise<{ dismissed: string[] }> {
    return this.actions.run(
      this.dismissAction,
      { symbol, dismissed },
      { key: `coin:${symbol}` },
    );
  }

  /** Stores the coin of a ticker (Einstellungen, dashboard). */
  setChoice(symbol: string, coin: CoinRef): Promise<CoinChoiceResult> {
    return this.actions.run(
      this.setAction,
      { symbol, coin },
      {
        key: `coin:${symbol}`,
        activity: { label: 'activity.coin', params: { asset: symbol } },
      },
    );
  }

  /** Removes it: the ticker rules apply again. */
  removeChoice(symbol: string): Promise<CoinChoiceResult> {
    return this.actions.run(this.removeAction, symbol, {
      key: `coin:${symbol}`,
    });
  }

  /** Kurse tab: stores the coin and fetches that asset's prices again (force). */
  chooseForProject(
    projectId: string,
    asset: string,
    coin: CoinRef,
  ): Promise<ChooseCoinResult> {
    return this.actions.run(
      this.chooseAction,
      { projectId, asset, coin },
      {
        key: `coin:${asset}`,
        activity: { label: 'activity.coin', params: { asset } },
      },
    );
  }
}
