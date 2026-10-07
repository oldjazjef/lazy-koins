import { Injectable } from '@nestjs/common';
import { AiSettingsRepositoryPort } from '../../ai/ports/ai-settings.repository.port';
import { MailSettingsRepositoryPort } from '../../mail/ports/mail.repository.port';
import { UserSettingsRepositoryPort } from '../../settings/ports/user-settings.repository.port';
import { ChainSettingsRepositoryPort } from '../../wallets/ports/wallet.repository.port';

/** Which sealed secrets were removed — for the answer, never their values. */
export interface ErasedKeys {
  readonly ai: boolean;
  readonly mail: boolean;
  readonly coingecko: boolean;
  readonly etherscan: boolean;
  /** Price sources: the CoinMarketCap key. */
  readonly coinmarketcap: boolean;
  /** Helius / Subscan (Einstellungen › Wallets & Netzwerke). */
  readonly chains: boolean;
}

/**
 * "PIN vergessen" on the desktop (F11.0p): whoever resets the PIN must not inherit the secrets
 * stored behind it, so every sealed key of the user is removed — the AI key, the mail password,
 * the CoinGecko, CoinMarketCap and Etherscan keys and the network keys (Helius, Subscan). Everything else
 * (projects, files, settings, addresses) stays.
 */
@Injectable()
export class SealedKeysEraser {
  constructor(
    private readonly settings: UserSettingsRepositoryPort,
    private readonly ai: AiSettingsRepositoryPort,
    private readonly mail: MailSettingsRepositoryPort,
    private readonly chains: ChainSettingsRepositoryPort,
  ) {}

  async eraseAll(userId: string): Promise<ErasedKeys> {
    const settings = await this.settings.find(userId);
    const coingecko = Boolean(settings?.sealedKeys.coingecko);
    const etherscan = Boolean(settings?.sealedKeys.etherscan);
    const coinmarketcap = Boolean(settings?.sealedKeys.coinmarketcap);
    if (coingecko || etherscan || coinmarketcap) {
      await this.settings.save(userId, {
        sealedKeys: { coingecko: null, etherscan: null, coinmarketcap: null },
      });
    }

    const ai = await this.ai.find(userId);
    if (ai?.apiKeyCipher) {
      const { userId: _user, updatedAt: _at, ...rest } = ai;
      await this.ai.save(userId, {
        ...rest,
        apiKeyCipher: null,
        apiKeyHint: null,
      });
    }

    const mail = await this.mail.find(userId);
    if (mail?.passwordCipher) {
      const { userId: _user, updatedAt: _at, ...rest } = mail;
      await this.mail.save(userId, {
        ...rest,
        passwordCipher: null,
        passwordHint: null,
      });
    }

    const chain = await this.chains.find(userId);
    const chains = Boolean(chain?.sealedHeliusKey || chain?.sealedSubscanKey);
    if (chains) {
      await this.chains.save(userId, {
        sealedHeliusKey: null,
        sealedSubscanKey: null,
      });
    }

    return {
      ai: Boolean(ai?.apiKeyCipher),
      mail: Boolean(mail?.passwordCipher),
      coingecko,
      etherscan,
      coinmarketcap,
      chains,
    };
  }
}
