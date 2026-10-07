import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { SecretBox } from '../../common/crypto/secret-box';
import { FakePriceHistorySources } from '../../rates/testing/fake-price-history';
import { FakeUsdSource } from '../../rates/testing/in-memory-project-rate.repository';
import { InMemoryUserSettingsRepository } from '../testing/in-memory-user-settings.repository';
import {
  GetPriceSourcesHandler,
  GetPriceSourcesQuery,
  TestPriceSourceCommand,
  TestPriceSourceHandler,
} from './price-sources.handlers';
import {
  GetSettingsHandler,
  GetSettingsQuery,
  SettingsReader,
  SettingsSecrets,
  UpdateSettingsCommand,
  UpdateSettingsHandler,
} from './settings.handlers';

const KEY = 'a-test-key-that-is-long-enough-for-aes-256-gcm';
const CMC_KEY = 'cmc-secret-key-9876';

function setup(ratesOnline = 'true') {
  const repo = new InMemoryUserSettingsRepository();
  const config = {
    get: (key: string) =>
      key === 'RATES_ONLINE'
        ? ratesOnline
        : key === 'SETTINGS_ENCRYPTION_KEY'
          ? KEY
          : undefined,
  } as unknown as ConfigService<Env, true>;
  const secrets = new SettingsSecrets(config);
  const reader = new SettingsReader(repo, secrets);
  const history = new FakePriceHistorySources();
  const usd = new FakeUsdSource({ BTC: '60000' });
  return {
    repo,
    reader,
    history,
    usd,
    get: new GetSettingsHandler(reader),
    update: new UpdateSettingsHandler(repo, secrets, reader),
    sources: new GetPriceSourcesHandler(reader, history),
    test: new TestPriceSourceHandler(reader, history, usd, config),
  };
}

describe('price sources in the settings (phase 2)', () => {
  it('lists every provider in the default order with what it offers — new providers off', async () => {
    const t = setup();
    const view = await t.sources.execute(new GetPriceSourcesQuery('anna'));
    expect(view.providers.map((p) => [p.id, p.enabled])).toEqual([
      ['binance', true],
      ['coingecko', true],
      ['coinmarketcap', false],
      ['defillama', false],
      ['coinpaprika', false],
      ['kraken', false],
      ['coinbase', false],
      ['bitfinex', false],
    ]);
    expect(view.providers.find((p) => p.id === 'coinmarketcap')).toMatchObject({
      key: 'required',
      freeHistoryDays: 365,
      dayPoint: 'startOfDay',
      attribution: 'Data provided by CoinMarketCap.com',
      keyHint: null,
    });
    expect(view.providers.find((p) => p.id === 'coinpaprika')).toMatchObject({
      personalUseOnly: true,
      quotes: ['USD'],
    });
    expect(view.providers.find((p) => p.id === 'binance')).toMatchObject({
      key: 'none',
      dayPoint: 'close',
      coinRef: 'ticker',
    });
  });

  it('stores the order as arranged; missing providers are appended off; duplicates are refused', async () => {
    const t = setup();
    const view = await t.update.execute(
      new UpdateSettingsCommand('anna', {
        priceSources: [
          { id: 'coinmarketcap', enabled: true },
          { id: 'kraken', enabled: true },
          { id: 'binance', enabled: false },
        ],
      }),
    );
    expect(view.priceSources).toEqual([
      { id: 'coinmarketcap', enabled: true },
      { id: 'kraken', enabled: true },
      { id: 'binance', enabled: false },
      { id: 'coingecko', enabled: false },
      { id: 'defillama', enabled: false },
      { id: 'coinpaprika', enabled: false },
      { id: 'coinbase', enabled: false },
      { id: 'bitfinex', enabled: false },
    ]);
    await expect(
      t.update.execute(
        new UpdateSettingsCommand('anna', {
          priceSources: [
            { id: 'kraken', enabled: true },
            { id: 'kraken', enabled: false },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('seals the CoinMarketCap key and never returns it — only a hint', async () => {
    const t = setup();
    const view = await t.update.execute(
      new UpdateSettingsCommand('anna', { keys: { coinmarketcap: CMC_KEY } }),
    );
    expect(view.keys.coinmarketcap).toBe('…9876');
    const stored = t.repo.rows.get('anna')?.sealedKeys.coinmarketcap ?? '';
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(new SecretBox(KEY).open(stored)).toBe(CMC_KEY);
    const list = await t.sources.execute(new GetPriceSourcesQuery('anna'));
    expect(list.providers.find((p) => p.id === 'coinmarketcap')?.keyHint).toBe(
      '…9876',
    );
    for (const answer of [
      view,
      list,
      await t.get.execute(new GetSettingsQuery('anna')),
    ]) {
      expect(JSON.stringify(answer)).not.toContain(CMC_KEY);
      expect(JSON.stringify(answer)).not.toContain(stored);
    }
  });

  it('"Testen": the typed key, else the stored one; plan and history depth come back, the key never', async () => {
    const t = setup();
    t.history.fake('coinmarketcap').testResult = {
      ok: true,
      status: 200,
      historyDays: 365,
      plan: '10000 credits/month, 30/min',
      detail: null,
    };
    await expect(
      t.test.execute(new TestPriceSourceCommand('anna', 'coinmarketcap')),
    ).rejects.toMatchObject({ response: { code: 'noKey' } });
    await t.update.execute(
      new UpdateSettingsCommand('anna', { keys: { coinmarketcap: CMC_KEY } }),
    );
    const result = await t.test.execute(
      new TestPriceSourceCommand('anna', 'coinmarketcap'),
    );
    expect(result).toMatchObject({
      provider: 'coinmarketcap',
      ok: true,
      historyDays: 365,
      plan: '10000 credits/month, 30/min',
    });
    // The fake echoes the key in its detail — the handler redacts it.
    expect(JSON.stringify(result)).not.toContain(CMC_KEY);

    t.history.fake('coinmarketcap').testResult = {
      ok: false,
      code: 'planLacksHistory',
      status: 403,
      historyDays: null,
      plan: null,
      detail: 'Your plan does not include historical data',
    };
    expect(
      await t.test.execute(
        new TestPriceSourceCommand('anna', 'coinmarketcap', 'typed-key-1'),
      ),
    ).toMatchObject({ ok: false, code: 'planLacksHistory', status: 403 });
  });

  it('"Testen" for keyless providers and Binance; refused offline', async () => {
    const t = setup();
    expect(
      await t.test.execute(new TestPriceSourceCommand('anna', 'kraken')),
    ).toMatchObject({ provider: 'kraken', ok: true });
    expect(
      await t.test.execute(new TestPriceSourceCommand('anna', 'binance')),
    ).toMatchObject({ provider: 'binance', ok: true, plan: 'Public' });
    t.usd.failFor.add('BTC');
    expect(
      await t.test.execute(new TestPriceSourceCommand('anna', 'binance')),
    ).toMatchObject({ provider: 'binance', ok: false, code: 'network' });
    await expect(
      setup('false').test.execute(
        new TestPriceSourceCommand('anna', 'defillama'),
      ),
    ).rejects.toMatchObject({ response: { code: 'offline' } });
  });
});
