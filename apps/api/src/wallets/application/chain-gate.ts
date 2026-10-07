import {
  BadGatewayException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SecretBox } from '../../common/crypto/secret-box';
import { checkBaseUrl } from '../../ai/domain/base-url';
import { SettingsReader } from '../../settings/application/settings.handlers';
import {
  type ChainSettings,
  defaultChainSettings,
  DEFAULT_URLS,
} from '../domain/chain-settings';
import { type ChainConnection, ChainDataError } from '../ports/chain-data.port';
import { ChainSettingsRepositoryPort } from '../ports/wallet.repository.port';

/** Process-wide options for the chain lookups (bound in `WalletsModule`). */
export class ChainRuntime {
  constructor(
    readonly box: SecretBox,
    /** `RATES_ONLINE=false` keeps the API offline for every user (F11.3). */
    readonly online: boolean,
    /** Private/loopback URLs allowed (same rule as the AI plugin). */
    readonly allowPrivateUrls: boolean,
  ) {}
}

/** Stable codes of the wallet slice's 409/422 answers; the app translates `wallets.errors.<code>`. */
export function walletConflict(
  code: string,
  message: string,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
  });
}

/** Unsaved values of the settings form (F6.7 "Testen" works on them). */
export interface ChainSettingsDraft {
  readonly etherscanKey?: string;
  readonly heliusKey?: string;
  readonly solanaRpcUrl?: string;
  readonly subscanKey?: string;
  readonly esploraUrl?: string;
  readonly koiosUrl?: string;
  readonly cosmosLcdUrl?: string;
}

/**
 * The gate every chain lookup passes: lookups on the internet allowed (F11.3: the user's switch
 * and `RATES_ONLINE`), keys opened only here and only for the call, URLs checked against SSRF
 * (private hosts refused on a server), and adapter errors turned into a 502 with a code and the
 * provider's (redacted) message — never the key.
 */
@Injectable()
export class ChainGate {
  constructor(
    private readonly settings: ChainSettingsRepositoryPort,
    private readonly reader: SettingsReader,
    private readonly runtime: ChainRuntime,
  ) {}

  async chainSettingsOf(userId: string): Promise<ChainSettings> {
    return (await this.settings.find(userId)) ?? defaultChainSettings(userId);
  }

  get box(): SecretBox {
    return this.runtime.box;
  }

  /** 422 for a URL the API must not call. */
  assertUrl(value: string): void {
    const problem = checkBaseUrl(value.trim(), this.runtime.allowPrivateUrls);
    if (problem) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'This address cannot be used',
        code: problem,
      });
    }
  }

  /** F11.3: no lookup when the user (or the operator) switched the internet off. */
  async assertOnline(userId: string): Promise<void> {
    if (!this.runtime.online) {
      throw walletConflict(
        'offline',
        'Online lookups are switched off (RATES_ONLINE=false)',
      );
    }
    const resolved = await this.reader.resolve(userId);
    if (!resolved.onlineRates) {
      throw walletConflict(
        'offline',
        'Online lookups are switched off in the settings',
      );
    }
  }

  /** The connection for one action: saved settings, overlaid with the form's draft. */
  async connection(
    userId: string,
    draft: ChainSettingsDraft = {},
  ): Promise<ChainConnection> {
    const resolved = await this.reader.resolve(userId);
    const stored = await this.chainSettingsOf(userId);
    const open = (sealed: string | null) =>
      sealed ? this.runtime.box.open(sealed) : undefined;
    const pick = (typed: string | undefined, saved: string | undefined) =>
      typed !== undefined && typed.trim() !== '' ? typed.trim() : saved;
    const etherscanKey = pick(draft.etherscanKey, resolved.keys.etherscan);
    const heliusKey = pick(draft.heliusKey, open(stored.sealedHeliusKey));
    const subscanKey = pick(draft.subscanKey, open(stored.sealedSubscanKey));
    const url = (
      typed: string | undefined,
      saved: string,
      fallback: string,
    ) => {
      const value = (typed ?? saved).trim();
      if (value === '') return fallback;
      this.assertUrl(value);
      return value.replace(/\/+$/, '');
    };
    const customRpc = (draft.solanaRpcUrl ?? stored.solanaRpcUrl).trim();
    let solanaRpcUrl: string;
    if (customRpc !== '') {
      this.assertUrl(customRpc);
      solanaRpcUrl = customRpc;
    } else if (heliusKey) {
      solanaRpcUrl = `${DEFAULT_URLS.helius}/?api-key=${encodeURIComponent(heliusKey)}`;
    } else {
      solanaRpcUrl = DEFAULT_URLS.solanaPublic;
    }
    const secrets = [etherscanKey, heliusKey, subscanKey].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    return {
      etherscanKey,
      subscanKey,
      solanaRpcUrl,
      esploraUrl: url(
        draft.esploraUrl,
        stored.esploraUrl,
        DEFAULT_URLS.esplora,
      ),
      koiosUrl: url(draft.koiosUrl, stored.koiosUrl, DEFAULT_URLS.koios),
      cosmosLcdUrl: url(
        draft.cosmosLcdUrl,
        stored.cosmosLcdUrl,
        DEFAULT_URLS.cosmosLcd,
      ),
      secrets,
    };
  }

  /** Runs one lookup; adapter errors → 502 `{ code, detail }` (409 for a missing key). */
  async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

export function toHttpError(error: unknown): unknown {
  if (!(error instanceof ChainDataError)) return error;
  if (error.code === 'notConfigured') {
    return walletConflict(
      'notConfigured',
      'The key for this network is missing',
    );
  }
  return new BadGatewayException({
    statusCode: 502,
    error: 'Bad Gateway',
    message: 'The network lookup failed',
    code: error.code,
    detail: error.detail,
    status: error.status,
  });
}
