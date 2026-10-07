import {
  chunkDays,
  DaySeries,
  PriceHttp,
  priceText,
} from './price-history-http';
import {
  PRICE_SOURCE_IDS,
  PriceSourceError,
} from './price-history-source.port';
import { PriceHistorySources } from './price-history-sources';
import { fakeFetch, json, opts, unreachable } from './testing/fake-fetch';

describe('price texts', () => {
  it('keeps every digit and expands exponents — never a JS number', () => {
    expect(priceText('0.123456789012345678901234')).toBe(
      '0.123456789012345678901234',
    );
    expect(priceText('1e-7')).toBe('0.0000001');
    expect(priceText('8.5E+4')).toBe('85000');
    expect(priceText('85000.10')).toBe('85000.1');
    // Anything that is not a positive decimal string is a missing day.
    expect(priceText(85000)).toBeUndefined();
    expect(priceText('0')).toBeUndefined();
    expect(priceText('-1')).toBeUndefined();
    expect(priceText(null)).toBeUndefined();
    expect(priceText('n/a')).toBeUndefined();
  });

  it('collects one value per day inside the range, before the unfinished day', () => {
    const first = new DaySeries(
      '2026-01-01',
      '2026-01-03',
      'first',
      '2026-01-03',
    );
    first.add('2025-12-31', '1');
    first.add('2026-01-01', '2');
    first.add('2026-01-01', '3');
    first.add('2026-01-02', '4');
    first.add('2026-01-03', '5');
    expect(first.toArray()).toEqual([
      { date: '2026-01-01', value: '2' },
      { date: '2026-01-02', value: '4' },
    ]);
    const last = new DaySeries('2026-01-01', '2026-01-01', 'last');
    last.add('2026-01-01', '2');
    last.add('2026-01-01', '3');
    expect(last.toArray()).toEqual([{ date: '2026-01-01', value: '3' }]);
  });

  it('cuts ranges into chunks', () => {
    expect(chunkDays('2025-01-01', '2025-01-05', 2)).toEqual([
      { from: '2025-01-01', to: '2025-01-02' },
      { from: '2025-01-03', to: '2025-01-04' },
      { from: '2025-01-05', to: '2025-01-05' },
    ]);
    expect(chunkDays('2025-01-01', '2025-01-01', 365)).toEqual([
      { from: '2025-01-01', to: '2025-01-01' },
    ]);
  });
});

describe('PriceHttp', () => {
  it('parses numbers as their source text', async () => {
    const { fetcher } = fakeFetch({
      x: json(200, '{"p": 0.91234567890123456789}'),
    });
    const answer = await new PriceHttp('defillama', opts(fetcher)).get(
      'https://x.test/a?key=secret-123456',
    );
    expect(answer.body).toEqual({ p: '0.91234567890123456789' });
    expect(answer.url).toBe('https://x.test/a');
  });

  it('times out with code timeout', async () => {
    const { fetcher } = fakeFetch({ x: 'hang' });
    await expect(
      new PriceHttp('defillama', opts(fetcher, { timeoutMs: 20 })).get(
        'https://x.test/',
      ),
    ).rejects.toMatchObject({ code: 'timeout', status: null });
  });

  it('refuses an answer over the size cap', async () => {
    const { fetcher } = fakeFetch({ x: json(200, `"${'a'.repeat(5000)}"`) });
    await expect(
      new PriceHttp('defillama', opts(fetcher, { maxBytes: 1000 })).get(
        'https://x.test/',
      ),
    ).rejects.toMatchObject({ code: 'badResponse' });
  });

  it('a transport failure is network with the system cause', async () => {
    const error = await new PriceHttp('kraken', opts(unreachable))
      .get('https://x.test/')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PriceSourceError);
    expect(error).toMatchObject({ code: 'network', detail: 'ECONNREFUSED' });
  });

  it('redacts the key from every detail', () => {
    const http = new PriceHttp('coinmarketcap', opts(unreachable));
    const error = http.error(
      'invalidKey',
      401,
      'This API Key is invalid: abc-SECRET-key-999',
      ['abc-SECRET-key-999'],
    );
    expect(error.detail).not.toContain('abc-SECRET-key-999');
    expect(error.message).not.toContain('abc-SECRET-key-999');
  });
});

describe('PriceHistorySources', () => {
  it('has exactly one adapter per id, each with capabilities', () => {
    const sources = PriceHistorySources.real();
    expect(sources.all().map((source) => source.id)).toEqual([
      ...PRICE_SOURCE_IDS,
    ]);
    for (const id of PRICE_SOURCE_IDS) {
      const source = sources.byId(id);
      expect(source.id).toBe(id);
      expect(source.capabilities.label).not.toBe('');
    }
  });

  it('makes no request when built', () => {
    const { fetcher, calls } = fakeFetch({});
    PriceHistorySources.real(opts(fetcher));
    expect(calls).toEqual([]);
  });
});
