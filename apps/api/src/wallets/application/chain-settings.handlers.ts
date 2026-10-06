import { ServiceUnavailableException } from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import type { NetworkFamily, NetworkId } from '@lazykoins/engine';
import {
  SettingsReader,
  UpdateSettingsCommand,
} from '../../settings/application/settings.handlers';
import { keyHint } from '../../settings/domain/user-settings';
import { type ChainService, DEFAULT_URLS } from '../domain/chain-settings';
import { ChainDataSourcesPort } from '../ports/chain-data.port';
import { ChainSettingsRepositoryPort } from '../ports/wallet.repository.port';
import { ChainGate, type ChainSettingsDraft } from './chain-gate';

/** F6.7 as the API shows it: keys only as hints, URLs as saved (empty = default). */
export interface ChainSettingsView {
  readonly keys: {
    readonly etherscan: string | null;
    readonly helius: string | null;
    readonly subscan: string | null;
  };
  readonly solanaRpcUrl: string;
  readonly esploraUrl: string;
  readonly koiosUrl: string;
  readonly cosmosLcdUrl: string;
  readonly defaults: {
    readonly esploraUrl: string;
    readonly koiosUrl: string;
    readonly cosmosLcdUrl: string;
    readonly solanaRpcUrl: string;
  };
  readonly keyStorageAvailable: boolean;
}

export class GetChainSettingsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetChainSettingsQuery)
export class GetChainSettingsHandler implements IQueryHandler<
  GetChainSettingsQuery,
  ChainSettingsView
> {
  constructor(
    private readonly gate: ChainGate,
    private readonly reader: SettingsReader,
  ) {}

  async execute({ userId }: GetChainSettingsQuery): Promise<ChainSettingsView> {
    const stored = await this.gate.chainSettingsOf(userId);
    const resolved = await this.reader.resolve(userId);
    const open = (sealed: string | null) =>
      sealed ? this.gate.box.open(sealed) : undefined;
    return {
      keys: {
        etherscan: keyHint(resolved.keys.etherscan),
        helius: keyHint(open(stored.sealedHeliusKey)),
        subscan: keyHint(open(stored.sealedSubscanKey)),
      },
      solanaRpcUrl: stored.solanaRpcUrl,
      esploraUrl: stored.esploraUrl,
      koiosUrl: stored.koiosUrl,
      cosmosLcdUrl: stored.cosmosLcdUrl,
      defaults: {
        esploraUrl: DEFAULT_URLS.esplora,
        koiosUrl: DEFAULT_URLS.koios,
        cosmosLcdUrl: DEFAULT_URLS.cosmosLcd,
        solanaRpcUrl: DEFAULT_URLS.solanaPublic,
      },
      keyStorageAvailable: this.gate.box.available,
    };
  }
}

/** A string stores the key, `''` or `null` removes it, absent keeps it. */
export interface ChainSettingsChanges {
  readonly etherscanKey?: string | null;
  readonly heliusKey?: string | null;
  readonly subscanKey?: string | null;
  readonly solanaRpcUrl?: string;
  readonly esploraUrl?: string;
  readonly koiosUrl?: string;
  readonly cosmosLcdUrl?: string;
}

export class SaveChainSettingsCommand {
  constructor(
    readonly userId: string,
    readonly changes: ChainSettingsChanges,
  ) {}
}

/** F6.7: keys sealed before they reach the database; URLs checked (SSRF) before they are kept. */
@CommandHandler(SaveChainSettingsCommand)
export class SaveChainSettingsHandler implements ICommandHandler<
  SaveChainSettingsCommand,
  ChainSettingsView
> {
  constructor(
    private readonly settings: ChainSettingsRepositoryPort,
    private readonly gate: ChainGate,
    private readonly commands: CommandBus,
    private readonly view: GetChainSettingsHandler,
  ) {}

  private seal(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    const trimmed = value?.trim() ?? '';
    if (trimmed === '') return null;
    if (!this.gate.box.available) {
      throw new ServiceUnavailableException(
        'API keys cannot be stored: SETTINGS_ENCRYPTION_KEY is not configured',
      );
    }
    return this.gate.box.seal(trimmed);
  }

  async execute({
    userId,
    changes,
  }: SaveChainSettingsCommand): Promise<ChainSettingsView> {
    for (const url of [
      changes.solanaRpcUrl,
      changes.esploraUrl,
      changes.koiosUrl,
      changes.cosmosLcdUrl,
    ]) {
      if (url !== undefined && url.trim() !== '') this.gate.assertUrl(url);
    }
    if (changes.etherscanKey !== undefined) {
      await this.commands.execute(
        new UpdateSettingsCommand(userId, {
          keys: { etherscan: changes.etherscanKey },
        }),
      );
    }
    await this.settings.save(userId, {
      sealedHeliusKey: this.seal(changes.heliusKey),
      sealedSubscanKey: this.seal(changes.subscanKey),
      solanaRpcUrl: changes.solanaRpcUrl?.trim(),
      esploraUrl: changes.esploraUrl?.trim(),
      koiosUrl: changes.koiosUrl?.trim(),
      cosmosLcdUrl: changes.cosmosLcdUrl?.trim(),
    });
    return this.view.execute(new GetChainSettingsQuery(userId));
  }
}

const SERVICE_TARGET: Readonly<
  Record<ChainService, { family: NetworkFamily; network: NetworkId }>
> = {
  etherscan: { family: 'evm', network: 'ethereum' },
  solana: { family: 'solana', network: 'solana' },
  esplora: { family: 'bitcoin', network: 'bitcoin' },
  koios: { family: 'cardano', network: 'cardano' },
  subscan: { family: 'polkadot', network: 'polkadot' },
  cosmos: { family: 'cosmos', network: 'cosmos' },
};

export interface ChainServiceTest {
  readonly ok: true;
  readonly service: ChainService;
  readonly detail: string;
  readonly millis: number;
}

export class TestChainServiceCommand {
  constructor(
    readonly userId: string,
    readonly service: ChainService,
    /** The form's values, saved or not (F6.7 "Testen" works on unsaved input). */
    readonly draft: ChainSettingsDraft,
  ) {}
}

/**
 * F6.7 "Testen": one request without user data (latest block / slot / epoch) with the form's
 * values over the saved ones. Errors come back as 502 `{ code, detail, status }` (redacted).
 */
@CommandHandler(TestChainServiceCommand)
export class TestChainServiceHandler implements ICommandHandler<
  TestChainServiceCommand,
  ChainServiceTest
> {
  constructor(
    private readonly gate: ChainGate,
    private readonly sources: ChainDataSourcesPort,
  ) {}

  async execute({
    userId,
    service,
    draft,
  }: TestChainServiceCommand): Promise<ChainServiceTest> {
    await this.gate.assertOnline(userId);
    const connection = await this.gate.connection(userId, draft);
    const target = SERVICE_TARGET[service];
    const started = Date.now();
    const detail = await this.gate.call(() =>
      this.sources.forFamily(target.family).test(connection, target.network),
    );
    return { ok: true, service, detail, millis: Date.now() - started };
  }
}
