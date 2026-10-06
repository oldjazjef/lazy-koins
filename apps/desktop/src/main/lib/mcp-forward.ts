/**
 * The stdio ↔ HTTP bridge of the desktop MCP server (F11.16), as a pure function: one JSON-RPC
 * message from the client (stdin) is POSTed to the app's loopback endpoint with the personal
 * access token; the answer's messages go back (stdout). Problems become JSON-RPC errors for the
 * request, so a client never waits forever.
 */
export type JsonRpcMessage = Record<string, unknown> & { jsonrpc: '2.0' };

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ForwardTarget {
  /** null = the desktop app is not running (no endpoint file). */
  readonly url: string | null;
  readonly token: string | undefined;
}

/** JSON-RPC: "server error" range, used for transport problems. */
const TRANSPORT_ERROR = -32001;

function requestId(message: JsonRpcMessage): string | number | undefined {
  const id = message['id'];
  return 'method' in message &&
    (typeof id === 'string' || typeof id === 'number')
    ? id
    : undefined;
}

function errorFor(message: JsonRpcMessage, text: string): JsonRpcMessage[] {
  const id = requestId(message);
  if (id === undefined) return [];
  return [
    { jsonrpc: '2.0', id, error: { code: TRANSPORT_ERROR, message: text } },
  ];
}

/** The messages of an answer body: JSON (one or an array) or an SSE stream's `data:` lines. */
export function messagesOf(
  body: string,
  contentType: string,
): JsonRpcMessage[] {
  const parse = (text: string): JsonRpcMessage[] => {
    const value = JSON.parse(text) as JsonRpcMessage | JsonRpcMessage[];
    return Array.isArray(value) ? value : [value];
  };
  if (contentType.includes('text/event-stream')) {
    return body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((data) => data !== '')
      .flatMap(parse);
  }
  return body.trim() === '' ? [] : parse(body);
}

export async function forwardMcpMessage(
  message: JsonRpcMessage,
  target: ForwardTarget,
  fetchImpl: FetchLike,
): Promise<JsonRpcMessage[]> {
  if (!target.token) {
    return errorFor(
      message,
      'LAZYKOINS_MCP_TOKEN is not set: create a token in lazy-koins under Einstellungen › MCP and put it into the client configuration.',
    );
  }
  if (!target.url) {
    return errorFor(
      message,
      'lazy-koins is not running (no MCP endpoint found): start the desktop app and switch the MCP server on under Einstellungen › MCP.',
    );
  }
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(target.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify(message),
    });
  } catch {
    return errorFor(
      message,
      `lazy-koins does not answer at ${target.url} — is the desktop app still running?`,
    );
  }
  if (response.status === 202 || response.status === 204) return [];
  const body = await response.text().catch(() => '');
  let out: JsonRpcMessage[];
  try {
    out = messagesOf(body, response.headers.get('content-type') ?? '');
  } catch {
    return errorFor(
      message,
      `lazy-koins answered HTTP ${response.status} without a JSON-RPC message`,
    );
  }
  // An auth error answers with `id: null` — give it the request's id so the client sees it.
  const id = requestId(message);
  return out.map((reply) =>
    reply['id'] === null && id !== undefined ? { ...reply, id } : reply,
  );
}
