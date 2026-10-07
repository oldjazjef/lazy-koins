import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpRemoteLibrary } from './http-remote-library.adapter';
import { RemoteLibraryError } from './remote-library.port';

/**
 * F5.18: the adapter against a local `node:http` fake of the public endpoint — never a real
 * server. Every failure must become a coded `RemoteLibraryError` without the answer's body.
 */

const ENTRY = {
  id: '01890a5d-ac96-774b-bcce-b302099a8057',
  name: 'Kraken Ledger',
  platform: 'kraken',
  description: 'Synthetic',
  authorName: 'Krakenfan',
  version: 2,
  fingerprint: 'aclass|amount|asset',
  ratingAverage: 4.5,
  ratingCount: 2,
  usageCount: 7,
  publishedAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T11:00:00.000Z',
};

type Handler = (
  request: IncomingMessage,
  body: string,
  response: ServerResponse,
) => void;

let server: Server;
let base: string;
let handler: Handler;
const seen: {
  method: string;
  url: string;
  body: string;
  headers: IncomingMessage['headers'];
}[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        body,
        headers: request.headers,
      });
      handler(request, body, response);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
});

beforeEach(() => {
  seen.length = 0;
});

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function failure(work: Promise<unknown>): Promise<RemoteLibraryError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof RemoteLibraryError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

const adapter = (
  limits?: Partial<{
    timeoutMs: number;
    maxListBytes: number;
    maxEntryBytes: number;
  }>,
) =>
  new HttpRemoteLibrary(fetch, {
    timeoutMs: 2000,
    maxListBytes: 512 * 1024,
    maxEntryBytes: 256 * 1024,
    ...limits,
  });

describe('HttpRemoteLibrary (F5.18)', () => {
  it('searches with the query parameters, no credentials, and parses the page', async () => {
    handler = (_req, _body, res) =>
      json(res, 200, { items: [ENTRY], total: 1, offset: 0, limit: 50 });
    const page = await adapter().search(base, {
      search: 'kraken',
      sort: 'newest',
      offset: 0,
      limit: 50,
    });
    expect(page.items[0]).toEqual(ENTRY);
    expect(seen[0]?.url).toBe(
      '/api/public/library?search=kraken&sort=newest&offset=0&limit=50',
    );
    expect(seen[0]?.headers.authorization).toBeUndefined();
    expect(seen[0]?.headers.cookie).toBeUndefined();
  });

  it('sends exactly the file name and the header row for a match', async () => {
    handler = (_req, _body, res) => json(res, 200, { items: [ENTRY] });
    const found = await adapter().match(base, {
      fileName: 'ledgers.csv',
      headers: ['txid', 'asset'],
    });
    expect(found).toHaveLength(1);
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.url).toBe('/api/public/library/match');
    expect(JSON.parse(seen[0]?.body ?? '')).toEqual({
      fileName: 'ledgers.csv',
      headers: ['txid', 'asset'],
    });
  });

  it('reads one entry with its spec (validated later by the caller)', async () => {
    handler = (_req, _body, res) =>
      json(res, 200, { ...ENTRY, spec: { format: 'lazy-koins-mapping' } });
    const entry = await adapter().get(base, ENTRY.id);
    expect(entry.spec).toEqual({ format: 'lazy-koins-mapping' });
    expect(seen[0]?.url).toBe(`/api/public/library/${ENTRY.id}`);
  });

  it('maps a 404: the entry is gone (get) / no public library (list)', async () => {
    handler = (_req, _body, res) => json(res, 404, { message: 'Not found' });
    expect((await failure(adapter().get(base, ENTRY.id))).code).toBe(
      'notFound',
    );
    expect((await failure(adapter().search(base, {}))).code).toBe('disabled');
  });

  it('maps 429 and 5xx without the body', async () => {
    handler = (_req, _body, res) => json(res, 429, { message: 'slow down' });
    expect((await failure(adapter().search(base, {}))).code).toBe(
      'rateLimited',
    );
    handler = (_req, _body, res) => json(res, 500, { secret: 'stack trace' });
    const error = await failure(adapter().search(base, {}));
    expect(error.code).toBe('badResponse');
    expect(error.message).not.toContain('stack trace');
  });

  it('refuses to follow a redirect', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest' });
      res.end();
    };
    const error = await failure(adapter().search(base, {}));
    expect(error.code).toBe('network');
    expect(error.detail).toContain('302');
    expect(seen).toHaveLength(1);
  });

  it('times out', async () => {
    handler = () => undefined; // never answers
    const error = await failure(adapter({ timeoutMs: 200 }).search(base, {}));
    expect(error.code).toBe('timeout');
  });

  it('refuses an oversize answer (declared and streamed)', async () => {
    const big = {
      items: [],
      total: 0,
      offset: 0,
      limit: 1,
      pad: 'x'.repeat(5000),
    };
    handler = (_req, _body, res) => json(res, 200, big);
    expect(
      (await failure(adapter({ maxListBytes: 1000 }).search(base, {}))).code,
    ).toBe('badResponse');
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(`{"items":[],"pad":"${'x'.repeat(3000)}`);
      res.end(`${'y'.repeat(3000)}"}`);
    };
    const error = await failure(
      adapter({ maxListBytes: 1000 }).search(base, {}),
    );
    expect(error.code).toBe('badResponse');
    expect(error.detail).toContain('larger');
  });

  it('refuses invalid JSON and an unexpected shape', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>Login</html>');
    };
    expect((await failure(adapter().search(base, {}))).code).toBe(
      'badResponse',
    );
    handler = (_req, _body, res) =>
      json(res, 200, {
        items: [{ ...ENTRY, authorId: 'leak', id: 'not-a-uuid' }],
        total: 1,
        offset: 0,
        limit: 1,
      });
    const error = await failure(adapter().search(base, {}));
    expect(error.code).toBe('badResponse');
    expect(error.detail).toContain('items.0.id');
  });

  it('drops keys the schema does not know (e.g. an author id a server sends)', async () => {
    handler = (_req, _body, res) =>
      json(res, 200, {
        items: [{ ...ENTRY, authorId: 'u1', authorEmail: 'a@example.org' }],
        total: 1,
        offset: 0,
        limit: 1,
      });
    const page = await adapter().search(base, {});
    expect(Object.keys(page.items[0] ?? {})).not.toContain('authorId');
    expect(JSON.stringify(page)).not.toContain('a@example.org');
  });

  it('reports an unreachable server as network (offline)', async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((done) => closed.close(() => done()));
    const error = await failure(
      adapter().search(`http://127.0.0.1:${port}`, {}),
    );
    expect(error.code).toBe('network');
    expect(error.detail).toBe('ECONNREFUSED');
  });
});
