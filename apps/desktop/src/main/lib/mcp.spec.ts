import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MCP_ENDPOINT_FILE,
  packagedUserData,
  readMcpEndpoint,
  removeMcpEndpoint,
  resolveMcpEndpoint,
  writeMcpEndpoint,
} from './mcp-endpoint';
import { type FetchLike, forwardMcpMessage, messagesOf } from './mcp-forward';

describe('MCP endpoint file (F11.16, desktop)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lk-mcp-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes, reads and removes only its own endpoint', () => {
    writeMcpEndpoint(dir, { url: 'http://127.0.0.1:51234/api/mcp', pid: 42 });
    expect(readMcpEndpoint(dir)).toEqual({
      url: 'http://127.0.0.1:51234/api/mcp',
      pid: 42,
    });
    removeMcpEndpoint(dir, 7);
    expect(readMcpEndpoint(dir)).not.toBeNull();
    removeMcpEndpoint(dir, 42);
    expect(readMcpEndpoint(dir)).toBeNull();
  });

  it('accepts loopback MCP URLs only', () => {
    writeFileSync(
      join(dir, MCP_ENDPOINT_FILE),
      JSON.stringify({ url: 'http://evil.example:80/api/mcp', pid: 1 }),
    );
    expect(readMcpEndpoint(dir)).toBeNull();
    expect(
      resolveMcpEndpoint(
        { LAZYKOINS_MCP_URL: 'http://10.0.0.1:1/api/mcp' },
        'linux',
        '/h',
      ).url,
    ).toBeNull();
  });

  it('finds the endpoint via LAZYKOINS_DATA_DIR, and knows the packaged userData', () => {
    writeMcpEndpoint(dir, { url: 'http://127.0.0.1:4440/api/mcp', pid: 3 });
    expect(
      resolveMcpEndpoint({ LAZYKOINS_DATA_DIR: dir }, 'win32', 'C:\\h'),
    ).toEqual({
      url: 'http://127.0.0.1:4440/api/mcp',
      dataDir: dir,
    });
    expect(packagedUserData('win32', { APPDATA: 'C:\\R' }, 'C:\\h')).toBe(
      join('C:\\R', 'lazy-koins'),
    );
    expect(packagedUserData('darwin', {}, '/Users/a')).toBe(
      join('/Users/a', 'Library', 'Application Support', 'lazy-koins'),
    );
  });
});

function fakeFetch(
  status: number,
  body: string,
  contentType = 'application/json',
) {
  const calls: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => contentType },
      text: async () => body,
    };
  };
  return { fetchImpl, calls };
}

describe('forwardMcpMessage (stdio ↔ HTTP)', () => {
  const request = { jsonrpc: '2.0' as const, id: 5, method: 'tools/list' };
  const target = { url: 'http://127.0.0.1:4440/api/mcp', token: 'lkmcp_abc' };

  it('posts the message with the token and returns the answer', async () => {
    const { fetchImpl, calls } = fakeFetch(
      200,
      JSON.stringify({ jsonrpc: '2.0', id: 5, result: { tools: [] } }),
    );
    expect(await forwardMcpMessage(request, target, fetchImpl)).toEqual([
      { jsonrpc: '2.0', id: 5, result: { tools: [] } },
    ]);
    expect(calls[0]?.headers['authorization']).toBe('Bearer lkmcp_abc');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual(request);
  });

  it('answers notifications with nothing (202) and reads SSE bodies', async () => {
    expect(
      await forwardMcpMessage(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        target,
        fakeFetch(202, '').fetchImpl,
      ),
    ).toEqual([]);
    expect(
      messagesOf(
        'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n',
        'text/event-stream',
      ),
    ).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  });

  it('turns a missing app, a missing token and refused tokens into errors for the request', async () => {
    const offline = await forwardMcpMessage(
      request,
      { url: null, token: 'x' },
      fakeFetch(200, '').fetchImpl,
    );
    expect(offline[0]).toEqual(
      expect.objectContaining({
        id: 5,
        error: expect.objectContaining({ code: -32001 }),
      }),
    );
    expect(JSON.stringify(offline)).toContain('not running');
    const noToken = await forwardMcpMessage(
      request,
      { url: target.url, token: undefined },
      fakeFetch(200, '').fetchImpl,
    );
    expect(JSON.stringify(noToken)).toContain('LAZYKOINS_MCP_TOKEN');
    const refused = await forwardMcpMessage(
      request,
      target,
      fakeFetch(
        401,
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32001, message: 'The token was revoked' },
        }),
      ).fetchImpl,
    );
    expect(refused).toEqual([
      {
        jsonrpc: '2.0',
        id: 5,
        error: { code: -32001, message: 'The token was revoked' },
      },
    ]);
    const down: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(
      JSON.stringify(await forwardMcpMessage(request, target, down)),
    ).toContain('does not answer');
  });
});
