import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChainConnection } from '../../wallets/ports/chain-data.port';
import { ChainDataError } from '../../wallets/ports/chain-data.port';
import { parseJsonKeepingNumbers } from '../rates/http-rate-client';
import { ChainHttpClient, type Fetcher, redact } from './chain-http';
import { CosmosLcdAdapter } from './cosmos-lcd.adapter';
import { EsploraAdapter } from './esplora.adapter';
import { EtherscanAdapter } from './etherscan.adapter';
import { cardanoEpochStart, KoiosAdapter } from './koios.adapter';
import { movementsOf, SolanaRpcAdapter } from './solana-rpc.adapter';
import { SubscanAdapter } from './subscan.adapter';

/**
 * The chain adapters against SYNTHETIC recorded responses (hand-written fixtures in the providers'
 * real shape, fake addresses) — never a real API call.
 */
const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const ME = '0x1111111111111111111111111111111111111111';
const KEY = 'TESTKEY-ETHERSCAN-0000';

const connection: ChainConnection = {
  etherscanKey: KEY,
  esploraUrl: 'https://esplora.test/api',
  solanaRpcUrl: 'https://rpc.test',
  subscanKey: 'TESTKEY-SUBSCAN-0000',
  koiosUrl: 'https://koios.test/api/v1',
  cosmosLcdUrl: 'https://lcd.test',
  secrets: [KEY, 'TESTKEY-SUBSCAN-0000'],
};

/** A fetch double: the first rule whose test matches answers; every call is recorded. */
function fakeFetch(
  rules: {
    match: (url: string, body: string) => boolean;
    status?: number;
    body: string;
  }[],
) {
  const calls: {
    url: string;
    body: string;
    headers: Record<string, string>;
  }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({
      url,
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const rule = rules.find((r) => r.match(url, body));
    return new Response(rule?.body ?? '{}', {
      status: rule?.status ?? (rule ? 200 : 404),
    });
  };
  return { fetcher, calls };
}

const has = (part: string) => (url: string) => url.includes(part);

describe('Etherscan API V2 (EVM)', () => {
  const answers = () =>
    fakeFetch([
      {
        match: has('action=txlistinternal'),
        body: fixture('etherscan-txlistinternal.json'),
      },
      { match: has('action=txlist'), body: fixture('etherscan-txlist.json') },
      { match: has('action=tokentx'), body: fixture('etherscan-tokentx.json') },
      {
        match: has('eth_getTransactionCount'),
        body: '{"jsonrpc":"2.0","id":1,"result":"0x3"}',
      },
      {
        match: has('eth_blockNumber'),
        body: '{"jsonrpc":"2.0","id":1,"result":"0x1312d00"}',
      },
    ]);

  it('turns txlist, internal and token transfers into movements (gas on outgoing, failed = fee only)', async () => {
    const { fetcher, calls } = answers();
    const adapter = new EtherscanAdapter(fetcher, 0);
    const { movements, info } = await adapter.history(
      connection,
      'ethereum',
      ME,
    );
    expect(calls[0]?.url).toContain(
      'https://api.etherscan.io/v2/api?chainid=1&',
    );
    const summary = movements.map((m) => [m.asset, m.quantity, m.fee, m.type]);
    expect(summary).toEqual([
      ['ETH', '2', null, 'transfer'],
      ['ETH', '-0.5', '0.00042', 'transfer'],
      ['ETH', '0', '0.0005', 'transfer'],
      ['ETH', '0', '0.0003', 'failed'],
      ['ETH', '0.25', null, 'transfer'],
      ['USDC', '250', null, 'transfer'],
      ['USDC', '-100', null, 'transfer'],
      ['USDT', '5000', null, 'transfer'],
    ]);
    expect(movements[0]).toMatchObject({
      timestamp: '2025-01-01T10:00:00.000Z',
      txHash:
        '0xaaa0000000000000000000000000000000000000000000000000000000000001',
    });
    expect(movements.at(-1)?.tokenName).toContain('Claim');
    expect(info.truncated).toBe(false);
  });

  it('selects the chain by chainid and checks activity (outgoing count = nonce)', async () => {
    const { fetcher, calls } = answers();
    const activity = await new EtherscanAdapter(fetcher, 0).activity(
      connection,
      'base',
      ME,
    );
    expect(activity).toEqual({ used: true, txCount: 3 });
    expect(calls.every((c) => c.url.includes('chainid=8453'))).toBe(true);
  });

  it('answers "no transactions" as unused', async () => {
    const { fetcher } = fakeFetch([
      {
        match: has('eth_getTransactionCount'),
        body: '{"jsonrpc":"2.0","id":1,"result":"0x0"}',
      },
      {
        match: () => true,
        body: '{"status":"0","message":"No transactions found","result":[]}',
      },
    ]);
    expect(
      await new EtherscanAdapter(fetcher, 0).activity(
        connection,
        'polygon',
        ME,
      ),
    ).toEqual({
      used: false,
      txCount: 0,
    });
  });

  it.each([
    [
      '{"status":"0","message":"NOTOK","result":"Invalid API Key (#err2)|' +
        KEY +
        '"}',
      'invalidKey',
    ],
    [
      '{"status":"0","message":"NOTOK","result":"Max calls per sec rate limit reached (5/sec)"}',
      'rateLimited',
    ],
    [
      '{"status":"0","message":"NOTOK","result":"Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage."}',
      'chainNotOnPlan',
    ],
  ])(
    'maps errors to codes and never repeats the key: %s',
    async (body, code) => {
      const { fetcher } = fakeFetch([{ match: () => true, body }]);
      const error = await new EtherscanAdapter(fetcher, 0)
        .history(connection, 'bsc', ME)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ChainDataError);
      expect((error as ChainDataError).code).toBe(code);
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect((error as ChainDataError).detail ?? '').not.toContain(KEY);
      expect((error as Error).message).not.toContain(KEY);
    },
  );

  it('refuses without a key (notConfigured) before any request', async () => {
    const { fetcher, calls } = fakeFetch([]);
    await expect(
      new EtherscanAdapter(fetcher, 0).test(
        { ...connection, etherscanKey: undefined },
        'ethereum',
      ),
    ).rejects.toMatchObject({ code: 'notConfigured' });
    expect(calls).toHaveLength(0);
  });

  it('tests the key with the latest block', async () => {
    const { fetcher } = answers();
    expect(
      await new EtherscanAdapter(fetcher, 0).test(connection, 'ethereum'),
    ).toBe('Block 20000000');
  });
});

describe('Esplora (Bitcoin)', () => {
  const ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
  const CHANGE = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';
  const stats = (count: number) =>
    JSON.stringify({
      address: 'x',
      chain_stats: {
        funded_txo_count: count,
        funded_txo_sum: 0,
        spent_txo_count: 0,
        spent_txo_sum: 0,
        tx_count: count,
      },
      mempool_stats: {
        funded_txo_count: 0,
        funded_txo_sum: 0,
        spent_txo_count: 0,
        spent_txo_sum: 0,
        tx_count: 0,
      },
    });

  it('nets each transaction over the own addresses; the paid fee is the fee; unconfirmed left out', async () => {
    const { fetcher } = fakeFetch([
      {
        match: has(`/address/${ADDRESS}/txs`),
        body: fixture('esplora-txs.json'),
      },
      { match: has(`/address/${ADDRESS}`), body: stats(2) },
    ]);
    const { movements } = await new EsploraAdapter(fetcher, 0).history(
      connection,
      'bitcoin',
      ADDRESS,
    );
    expect(movements.map((m) => [m.quantity, m.fee])).toEqual([
      // A single address: 1 000 000 spent, the change went elsewhere, fee 1 500.
      ['-0.009985', '0.000015'],
      ['0.01', null],
    ]);
  });

  it('derives xpub addresses (receive + change) until 20 unused in a row', async () => {
    const zpub =
      'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
    const { fetcher, calls } = fakeFetch([
      {
        match: has(`/address/${ADDRESS}/txs`),
        body: fixture('esplora-txs.json'),
      },
      {
        match: has(`/address/${CHANGE}/txs`),
        body: fixture('esplora-txs.json'),
      },
      {
        match: (url) =>
          url.endsWith(`/address/${ADDRESS}`) ||
          url.endsWith(`/address/${CHANGE}`),
        body: stats(1),
      },
      { match: has('/address/'), body: stats(0) },
    ]);
    const adapter = new EsploraAdapter(fetcher, 0);
    const { movements, info } = await adapter.history(
      connection,
      'bitcoin',
      zpub,
    );
    expect(info).toMatchObject({ addressesScanned: 42, addressesUsed: 2 });
    // The change output is own now: the 2nd tx moved 300 000 out, fee 1 500.
    expect(movements.map((m) => m.quantity)).toEqual(['-0.003', '0.01']);
    expect(calls.some((c) => c.url.includes(zpub))).toBe(false);
  });

  it('tests the endpoint with the tip height', async () => {
    const { fetcher } = fakeFetch([
      { match: has('/blocks/tip/height'), body: '880123' },
    ]);
    expect(await new EsploraAdapter(fetcher, 0).test(connection)).toBe(
      'Block 880123',
    );
  });
});

describe('Solana RPC', () => {
  const WALLET = 'FakeWa11et1111111111111111111111111111111111';

  it('reads SOL from pre/post balances (fee payer pays the fee) and SPL by owner', () => {
    const tx = (
      parseJsonKeepingNumbers(fixture('solana-transaction.json')) as {
        result: Record<string, unknown>;
      }
    ).result;
    expect(
      movementsOf(tx, '5igFakeSignature111', WALLET).map((m) => [
        m.asset,
        m.quantity,
        m.fee,
      ]),
    ).toEqual([
      ['SOL', '-1', '0.000005'],
      ['USDC', '120', null],
    ]);
  });

  it('pages signatures, reads every transaction, keeps the RPC key out of errors', async () => {
    const { fetcher } = fakeFetch([
      {
        match: (_url, body) => body.includes('getSignaturesForAddress'),
        body: '{"jsonrpc":"2.0","id":1,"result":[{"signature":"5igFakeSignature111","blockTime":1740000000,"err":null}]}',
      },
      {
        match: (_url, body) => body.includes('getTransaction'),
        body: fixture('solana-transaction.json'),
      },
      {
        match: (_url, body) => body.includes('getSlot'),
        body: '{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"bad key ?api-key=SECRET123"}}',
      },
    ]);
    const adapter = new SolanaRpcAdapter(fetcher, 0);
    const { movements } = await adapter.history(connection, 'solana', WALLET);
    expect(movements).toHaveLength(2);
    const error = await adapter
      .test({ ...connection, secrets: ['SECRET123'] })
      .catch((e: unknown) => e as ChainDataError);
    expect(error).toMatchObject({ code: 'providerError' });
    expect((error as ChainDataError).detail).not.toContain('SECRET123');
  });
});

describe('Koios (Cardano), Subscan (Polkadot), LCD (Cosmos)', () => {
  it('Cardano: rewards as income at the start of the spendable epoch, current balance as info', async () => {
    const { fetcher } = fakeFetch([
      {
        match: has('/address_info'),
        body: '[{"address":"addr1fake","balance":"0","stake_address":"stake1fake","utxo_set":[]}]',
      },
      {
        match: has('/account_info'),
        body: '[{"stake_address":"stake1fake","status":"registered","total_balance":"1250500000"}]',
      },
      {
        match: has('/account_rewards'),
        body: '[{"stake_address":"stake1fake","rewards":[{"earned_epoch":538,"spendable_epoch":540,"amount":"3500000","type":"member","pool_id":"pool1fake"}]}]',
      },
    ]);
    const history = await new KoiosAdapter(fetcher, 0).history(
      connection,
      'cardano',
      'addr1fake',
    );
    expect(history.movements).toEqual([
      expect.objectContaining({
        type: 'reward',
        asset: 'ADA',
        quantity: '3.5',
        timestamp: cardanoEpochStart(540),
      }),
    ]);
    expect(history.info.currentBalances).toEqual([
      { asset: 'ADA', quantity: '1250.5' },
    ]);
    expect(cardanoEpochStart(208)).toBe('2020-07-29T21:44:51.000Z');
  });

  it('Polkadot: needs the Subscan key, sends it as a header, rewards in planck', async () => {
    const { fetcher, calls } = fakeFetch([
      {
        match: has('/scan/search'),
        body: '{"code":0,"message":"Success","data":{"account":{"address":"1fake","balance":"120.3","count_extrinsic":4}}}',
      },
      {
        match: has('/reward_slash'),
        body: '{"code":0,"message":"Success","data":{"count":1,"list":[{"amount":"4200000000","block_timestamp":1741564800,"event_index":"25000000-12"}]}}',
      },
    ]);
    const adapter = new SubscanAdapter(fetcher, 0);
    const history = await adapter.history(connection, 'polkadot', '1fake');
    expect(history.movements.map((m) => [m.quantity, m.type])).toEqual([
      ['0.42', 'reward'],
    ]);
    expect(calls[0]?.headers['x-api-key']).toBe('TESTKEY-SUBSCAN-0000');
    expect(calls[0]?.url).not.toContain('TESTKEY');
    await expect(
      adapter.activity(
        { ...connection, subscanKey: undefined },
        'polkadot',
        '1fake',
      ),
    ).rejects.toMatchObject({ code: 'notConfigured' });
  });

  it('Cosmos: activity from the account, a 404 is unused; balance only as information', async () => {
    const { fetcher } = fakeFetch([
      {
        match: has('/accounts/cosmos1unused'),
        status: 404,
        body: '{"code":5,"message":"not found"}',
      },
      {
        match: has('/accounts/'),
        body: '{"account":{"@type":"/cosmos.auth.v1beta1.BaseAccount","sequence":"7"}}',
      },
      {
        match: has('/balances/'),
        body: '{"balances":[{"denom":"uatom","amount":"42100000"}]}',
      },
    ]);
    const adapter = new CosmosLcdAdapter(fetcher, 0);
    expect(await adapter.activity(connection, 'cosmos', 'cosmos1used')).toEqual(
      { used: true, txCount: 7 },
    );
    expect(
      await adapter.activity(connection, 'cosmos', 'cosmos1unused'),
    ).toEqual({ used: false, txCount: null });
    const history = await adapter.history(connection, 'cosmos', 'cosmos1used');
    expect(history.movements).toEqual([]);
    expect(history.info.currentBalances).toEqual([
      { asset: 'ATOM', quantity: '42.1' },
    ]);
  });
});

describe('ChainHttpClient', () => {
  it('serves repeated questions from the cache, but never across keys', async () => {
    const { fetcher, calls } = fakeFetch([
      { match: () => true, body: '{"ok":true}' },
    ]);
    const client = new ChainHttpClient(fetcher, 0);
    await client.request({
      url: 'https://x.test/a?apikey=K1',
      secrets: ['K1'],
    });
    await client.request({
      url: 'https://x.test/a?apikey=K1',
      secrets: ['K1'],
    });
    await client.request({
      url: 'https://x.test/a?apikey=K2',
      secrets: ['K2'],
    });
    expect(calls).toHaveLength(2);
  });

  it('maps HTTP statuses and redacts the key from the provider message', async () => {
    const { fetcher } = fakeFetch([
      { match: () => true, status: 403, body: 'forbidden for apikey=K9SECRET' },
    ]);
    const error = await new ChainHttpClient(fetcher, 0)
      .request({
        url: 'https://x.test/?apikey=K9SECRET',
        secrets: ['K9SECRET'],
      })
      .catch((e: unknown) => e as ChainDataError);
    expect(error).toMatchObject({ code: 'invalidKey', status: 403 });
    expect(error.detail).not.toContain('K9SECRET');
    expect(redact('token=abc key=def', [])).toBe('token=… key=…');
  });
});
