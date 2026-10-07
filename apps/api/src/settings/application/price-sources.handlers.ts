import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import type { Env } from '../../config/env';
import {
  PriceHistorySourcesPort,
  type PriceSourceErrorCode,
} from '../../integrations/rates/price-history/price-history-source.port';
import { redactSecrets } from '../../integrations/ai/redact';
import { errorCode, providerInfo } from '../../rates/application/price-fetch';
import {
  addDays,
  isKeyedProvider,
  requiresKey,
  type PriceProviderId,
  type PriceProviderInfo,
} from '../../rates/domain/price-providers';
import { UsdPriceSourcePort } from '../../rates/ports/rate-source.port';
import { SettingsReader } from './settings.handlers';

/** One provider as Einstellungen › Kurse shows it: what it offers, on/off, its key's hint. */
export interface PriceSourceView extends PriceProviderInfo {
  readonly enabled: boolean;
  /** Keyed providers: `…abcd` when a key is stored, else `null`; never the key. */
  readonly keyHint: string | null;
}

export interface PriceSourcesView {
  /** In the user's order. */
  readonly providers: readonly PriceSourceView[];
  /** Whether keys can be stored at all (`SETTINGS_ENCRYPTION_KEY`). */
  readonly keyStorageAvailable: boolean;
}

export class GetPriceSourcesQuery {
  constructor(readonly userId: string) {}
}

/** Price sources phase 2: the provider list (order, on/off, capabilities, key hints). */
@QueryHandler(GetPriceSourcesQuery)
export class GetPriceSourcesHandler implements IQueryHandler<
  GetPriceSourcesQuery,
  PriceSourcesView
> {
  constructor(
    private readonly reader: SettingsReader,
    private readonly history: PriceHistorySourcesPort,
  ) {}

  async execute({ userId }: GetPriceSourcesQuery): Promise<PriceSourcesView> {
    const view = await this.reader.view(userId);
    return {
      providers: view.priceSources.map((setting) => ({
        ...providerInfo(this.history, setting.id),
        enabled: setting.enabled,
        keyHint: isKeyedProvider(setting.id)
          ? (view.keys[setting.id] ?? null)
          : null,
      })),
      keyStorageAvailable: view.keyStorageAvailable,
    };
  }
}

/** "Testen" of one provider — never the key, the provider's words redacted. */
export interface PriceSourceTestView {
  readonly provider: PriceProviderId;
  readonly ok: boolean;
  readonly code?: PriceSourceErrorCode;
  readonly status: number | null;
  /** Days of daily history the (key's) plan reaches as far as the test could tell; `null` = all/unknown. */
  readonly historyDays: number | null;
  readonly plan: string | null;
  readonly detail: string | null;
  readonly url: string;
  readonly millis: number;
}

export class TestPriceSourceCommand {
  constructor(
    readonly userId: string,
    readonly provider: PriceProviderId,
    /** A key typed into the form (unsaved, never stored); absent = the stored key. */
    readonly key?: string,
  ) {}
}

const BINANCE_URL = 'https://data-api.binance.vision/api/v3/klines';

/**
 * "Testen" per provider (price sources phase 2): the adapter's `test()` — CoinMarketCap shows its
 * plan (credits, rate) and how far back daily history reaches (365 / 1095 days), the others
 * reachability; Binance one recent daily close of BTC. 409 `offline` with `RATES_ONLINE=false`,
 * `noKey` for a keyed provider without a typed or stored key. No user data is sent.
 */
@CommandHandler(TestPriceSourceCommand)
export class TestPriceSourceHandler implements ICommandHandler<
  TestPriceSourceCommand,
  PriceSourceTestView
> {
  constructor(
    private readonly reader: SettingsReader,
    private readonly history: PriceHistorySourcesPort,
    private readonly usd: UsdPriceSourcePort,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async execute({
    userId,
    provider,
    key,
  }: TestPriceSourceCommand): Promise<PriceSourceTestView> {
    if (this.config.get('RATES_ONLINE', { infer: true }) === 'false') {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'Rate lookups on the internet are off on this server',
        code: 'offline',
      });
    }
    if (provider === 'binance') return this.testBinance();
    let apiKey: string | undefined;
    if (isKeyedProvider(provider)) {
      apiKey =
        key?.trim() || (await this.reader.resolve(userId)).keys[provider];
      if (!apiKey && requiresKey(provider)) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: `No ${provider} key entered or stored`,
          code: 'noKey',
        });
      }
    }
    const result = await this.history.byId(provider).test(apiKey);
    return {
      provider,
      ...result,
      // The adapters redact already; once more with the key, belt and braces.
      detail:
        result.detail === null
          ? null
          : redactSecrets(result.detail, apiKey ? [apiKey] : []),
    };
  }

  private async testBinance(): Promise<PriceSourceTestView> {
    const started = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    try {
      const entries = await this.usd.dailyUsd({
        asset: 'BTC',
        symbol: 'BTC',
        from: addDays(today, -3),
        to: addDays(today, -1),
      });
      return {
        provider: 'binance',
        ok: entries.length > 0,
        ...(entries.length > 0 ? {} : { code: 'badResponse' as const }),
        status: 200,
        historyDays: null,
        plan: 'Public',
        detail: null,
        url: BINANCE_URL,
        millis: Date.now() - started,
      };
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      return {
        provider: 'binance',
        ok: false,
        code: errorCode(error),
        status: typeof status === 'number' ? status : null,
        historyDays: null,
        plan: null,
        detail: null,
        url: BINANCE_URL,
        millis: Date.now() - started,
      };
    }
  }
}
