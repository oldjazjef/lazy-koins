import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { selectLatestInitialExport } from '../../../rates/domain/estv';
import { EstvSourceError } from '../../../rates/ports/estv.port';
import { IctaxKurslisteSource } from './ictax-kursliste.source';
import {
  KurslisteStreamParser,
  parseKurslisteStream,
} from './kursliste-stream-parser';
import {
  kurslisteBytes,
  kurslisteXml,
  NS_20,
  zip,
} from './testing/kursliste-fixtures';

/**
 * The ICTax client against a local fake server with the recorded shape of the real API
 * (session.json → csrfToken + cookie, xmls.json, download/<id>/<hash>/<name> → ZIP). No real
 * network call anywhere.
 */

interface FakeIctax {
  server: Server;
  baseUrl: string;
  requests: { method: string; url: string; csrf?: string; cookie?: string }[];
  /** Overrides per path prefix: status, or a body. */
  failures: Map<string, number[]>;
  archive: Buffer;
}

const ITEMS = [
  {
    id: 45812,
    deleted: false,
    exportDate: Date.parse('2026-03-02T08:00:00Z'),
    exportFile: {
      id: 4341535,
      fileName: 'kursliste_2025.zip',
      fileSize: 0,
      fileHash: 'hash220',
    },
    exportType: { categoryShortName: 'EXPTYP', shortName: 'THIRD.INIT.220' },
  },
  {
    id: 45811,
    exportDate: Date.parse('2026-03-02T07:59:00Z'),
    exportFile: {
      id: 4341533,
      fileName: 'kursliste_2025.zip',
      fileSize: 10,
      fileHash: 'delta220',
    },
    exportType: { shortName: 'THIRD.DELTA.220' },
  },
  {
    id: 45818,
    exportDate: Date.parse('2026-03-02T09:00:00Z'),
    exportFile: {
      id: 4341587,
      fileName: 'kursliste_2025.zip',
      fileSize: 10,
      fileHash: 'hash200',
    },
    exportType: { shortName: 'THIRD.INIT.200' },
  },
];

async function startFake(archive: Buffer): Promise<FakeIctax> {
  const fake: FakeIctax = {
    server: createServer(),
    baseUrl: '',
    requests: [],
    failures: new Map(),
    archive,
  };
  fake.server.on('request', (req, res) => {
    const url = req.url ?? '';
    fake.requests.push({
      method: req.method ?? '',
      url,
      csrf: req.headers['x-csrf-token'] as string | undefined,
      cookie: req.headers.cookie,
    });
    for (const [prefix, statuses] of fake.failures) {
      if (url.startsWith(prefix) && statuses.length > 0) {
        res.statusCode = statuses.shift() as number;
        res.end('failure');
        return;
      }
    }
    if (url === '/extern/api/authentication/session.json') {
      res.setHeader('set-cookie', [
        'JSESSIONID=abc123; Path=/; HttpOnly',
        'cookiesession1=xyz; Path=/',
      ]);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'SUCCESS',
          error: null,
          data: { csrfToken: 'token-1', authenticated: false },
        }),
      );
      return;
    }
    if (url === '/extern/api/xml/xmls.json' && req.method === 'POST') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        const { year } = JSON.parse(body) as { year: number };
        if (
          req.headers['x-csrf-token'] !== 'token-1' ||
          !String(req.headers.cookie).includes('JSESSIONID=abc123')
        ) {
          res.statusCode = 403;
          res.end('{}');
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            status: 'SUCCESS',
            error: null,
            data: year === 2025 ? ITEMS : [],
            totalItems: year === 2025 ? ITEMS.length : 0,
          }),
        );
      });
      return;
    }
    if (url.startsWith('/extern/api/download/4341535/hash220/')) {
      res.setHeader('content-type', 'application/zip;charset=UTF-8');
      res.setHeader('content-length', String(fake.archive.length));
      // Streamed in small chunks, like a slow connection.
      Readable.from(
        Array.from({ length: Math.ceil(fake.archive.length / 1000) }, (_, i) =>
          fake.archive.subarray(i * 1000, (i + 1) * 1000),
        ),
      ).pipe(res);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) =>
    fake.server.listen(0, '127.0.0.1', resolve),
  );
  fake.baseUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  return fake;
}

let fake: FakeIctax;

beforeEach(async () => {
  fake = await startFake(
    zip([
      { name: 'kursliste_2025.idx', data: Buffer.from('index') },
      { name: 'kursliste-2.2.0.xsd', data: Buffer.from('<xs:schema/>') },
      { name: 'kursliste_2025.xml', data: kurslisteBytes() },
    ]),
  );
});

afterEach(async () => {
  await new Promise((resolve) => fake.server.close(resolve));
});

const client = (
  extra: Partial<ConstructorParameters<typeof IctaxKurslisteSource>[0]> = {},
) =>
  new IctaxKurslisteSource({ baseUrl: fake.baseUrl, backoffMs: 1, ...extra });

describe('ICTax client (F7.4a)', () => {
  it('lists the exports of a year with the CSRF token and the session cookie', async () => {
    const exports = await client().listExports(2025);
    expect(exports).toEqual([
      {
        exportType: 'THIRD.INIT.220',
        exportDate: '2026-03-02T08:00:00.000Z',
        fileId: '4341535',
        fileHash: 'hash220',
        fileName: 'kursliste_2025.zip',
        fileSize: null,
      },
      expect.objectContaining({ exportType: 'THIRD.DELTA.220', fileSize: 10 }),
      expect.objectContaining({ exportType: 'THIRD.INIT.200' }),
    ]);
    const post = fake.requests.find((r) => r.method === 'POST');
    expect(post).toMatchObject({ csrf: 'token-1' });
    expect(post?.cookie).toBe('JSESSIONID=abc123; cookiesession1=xyz');
    // The highest schema wins even though INIT.200 is a minute newer.
    expect(selectLatestInitialExport(exports)?.fileHash).toBe('hash220');
    expect(await client().listExports(2019)).toEqual([]);
  });

  it('streams the ZIP, picks kursliste_<year>.xml and reads cryptos and year-end rates', async () => {
    const [latest] = await client().listExports(2025);
    const phases = new Set<string>();
    const parsed = await client().fetchKursliste(
      2025,
      latest as NonNullable<typeof latest>,
      (p) => phases.add(p.phase),
    );
    expect(parsed.year).toBe(2025);
    expect(parsed.schemaVersion).toBe('2.2.0');
    expect(parsed.rates).toEqual([
      {
        kind: 'crypto',
        ictaxId: '11',
        symbol: 'BTC',
        name: 'Bitcoin',
        valorNumber: '1000001',
        isin: null,
        value: '70000.123456',
      },
      expect.objectContaining({ symbol: 'ETH', value: '2400.5' }),
      // denomination 1000: CHF per unit.
      expect.objectContaining({ symbol: 'MINI', value: '0.002' }),
      expect.objectContaining({ kind: 'fx', symbol: 'EUR', value: '0.9305' }),
      expect.objectContaining({ kind: 'fx', symbol: 'JPY', value: '0.005054' }),
      expect.objectContaining({ kind: 'fx', symbol: 'USD', value: '0.79225' }),
    ]);
    expect([...phases]).toEqual(['download', 'parse']);
  });

  it('retries 5xx with backoff and gives up on 4xx', async () => {
    fake.failures.set('/extern/api/xml/xmls.json', [503, 502]);
    expect(await client().listExports(2025)).toHaveLength(3);
    fake.failures.set('/extern/api/xml/xmls.json', [503, 503, 503]);
    await expect(client().listExports(2025)).rejects.toMatchObject({
      code: 'http',
      message: 'ICTax: HTTP 503',
    });
    fake.failures.set('/extern/api/xml/xmls.json', [403]);
    await expect(
      client({ attempts: 5 }).listExports(2025),
    ).rejects.toBeInstanceOf(EstvSourceError);
  });

  it('refuses a ZIP above the size limit and a response that is no ZIP', async () => {
    const [latest] = await client().listExports(2025);
    const file = latest as NonNullable<typeof latest>;
    await expect(
      client({ maxZipBytes: 100 }).fetchKursliste(2025, file),
    ).rejects.toMatchObject({ code: 'tooLarge' });
    fake.archive = Buffer.from('<html>Sitzung abgelaufen</html>');
    await expect(client().fetchKursliste(2025, file)).rejects.toMatchObject({
      code: 'badArchive',
    });
  });

  it('refuses a list of another year and an archive without XML', async () => {
    const [latest] = await client().listExports(2025);
    const file = latest as NonNullable<typeof latest>;
    fake.archive = zip([
      { name: 'kursliste_2025.xml', data: kurslisteBytes({ year: 2024 }) },
    ]);
    await expect(client().fetchKursliste(2025, file)).rejects.toMatchObject({
      code: 'badXml',
    });
    fake.archive = zip([{ name: 'readme.txt', data: Buffer.from('x') }]);
    await expect(client().fetchKursliste(2025, file)).rejects.toMatchObject({
      code: 'badArchive',
    });
  });

  it('reports an unreachable server as a network error', async () => {
    await expect(
      new IctaxKurslisteSource({
        baseUrl: 'http://127.0.0.1:1',
        attempts: 2,
        backoffMs: 1,
      }).listExports(2025),
    ).rejects.toMatchObject({ code: 'network' });
  });
});

describe('Kursliste stream parser', () => {
  it('reads schema 2.0.0 with prefixed elements in UTF-8, chunk by chunk', async () => {
    const bytes = kurslisteBytes({
      namespace: NS_20,
      prefix: 'kl',
      encoding: 'UTF-8',
    });
    const chunks = Array.from({ length: Math.ceil(bytes.length / 7) }, (_, i) =>
      bytes.subarray(i * 7, (i + 1) * 7),
    );
    const parsed = await parseKurslisteStream(Readable.from(chunks));
    expect(parsed.schemaVersion).toBe('2.0.0');
    expect(parsed.rates.map((r) => r.symbol)).toEqual([
      'BTC',
      'ETH',
      'MINI',
      'EUR',
      'JPY',
      'USD',
    ]);
  });

  it('streams a large-ish file (thousands of other securities) without keeping them', async () => {
    const xml = kurslisteXml({ fillerShares: 20_000 });
    expect(xml.length).toBeGreaterThan(5_000_000);
    const parser = new KurslisteStreamParser();
    const bytes = Buffer.from(xml, 'latin1');
    for (let at = 0; at < bytes.length; at += 64 * 1024) {
      parser.write(bytes.subarray(at, at + 64 * 1024));
    }
    const parsed = parser.end();
    expect(parser.bytes).toBe(bytes.length);
    expect(parsed.rates).toHaveLength(6);
  });

  it('decodes ISO-8859-1 names', () => {
    const parser = new KurslisteStreamParser();
    const xml = kurslisteXml().replace(
      'securityName="Ethereum"',
      'securityName="Éther Münze"',
    );
    parser.write(Buffer.from(xml, 'latin1'));
    expect(parser.end().rates.find((r) => r.symbol === 'ETH')?.name).toBe(
      'Éther Münze',
    );
  });

  it('refuses other XML and broken XML', () => {
    const other = new KurslisteStreamParser();
    other.write(Buffer.from('<?xml version="1.0"?><html><body/></html>'));
    expect(() => other.end()).toThrow(EstvSourceError);
    const unknown = new KurslisteStreamParser();
    unknown.write(
      Buffer.from('<kursliste xmlns="http://example.com/x" year="2025"/>'),
    );
    expect(() => unknown.end()).toThrow(/Namensraum/);
    const broken = new KurslisteStreamParser();
    expect(() => {
      broken.write(Buffer.from(kurslisteXml().slice(0, 2000) + '<<>'));
      broken.end();
    }).toThrow(EstvSourceError);
  });
});
