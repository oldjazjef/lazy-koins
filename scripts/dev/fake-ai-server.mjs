#!/usr/bin/env node
/**
 * A FAKE OpenAI-compatible provider for trying the AI plugin locally without an account, a key or
 * a network: `POST /v1/chat/completions` answers deterministically, no model involved.
 *
 *   node scripts/dev/fake-ai-server.mjs [port]      (default 11435)
 *
 * Then, in the app's settings → AI: provider "OpenAI-kompatibel", address
 * `http://localhost:11435/v1`, any model name, no key (needs AI_ALLOW_PRIVATE_URLS or
 * AUTH_MODE dev/local, which allow local addresses).
 *
 * - `mapping_spec`: returns the synthetic example mapping (libs/engine/src/mapping/fixtures)
 *   whose `match.headers` all occur in the sample's rows — so the engine's synthetic fixtures
 *   (Kraken, Binance, Bitfinex, Revolut) get a working mapping; anything else gets a skeleton.
 * - `statement_holdings`: reads lines `TICKER  <quantity> …` from the page texts and returns
 *   them exactly as printed, with the date of an "as of dd.mm.yyyy" line.
 * - `connection_test`: `{ "ok": true }`.
 *
 * Reports token usage like a real provider. Logs only the request kind, never content.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? process.env.PORT ?? 11435);
const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../libs/engine/src/mapping/fixtures',
);
const specs = readdirSync(fixtures)
  .filter((name) => name.endsWith('.mapping.json'))
  .map((name) => JSON.parse(readFileSync(path.join(fixtures, name), 'utf8')));

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[\s_-]/g, '');

function mappingFor(sample) {
  const cells = new Set((sample.rows ?? []).flat().map(norm));
  const fit = specs
    .filter((spec) => spec.match.headers.every((h) => cells.has(norm(h))))
    .sort((a, b) => b.match.headers.length - a.match.headers.length)[0];
  if (fit) return structuredClone(fit);
  const header = (sample.rows ?? [])[(sample.headerRowGuess ?? 1) - 1] ?? [];
  return {
    format: 'lazy-koins-mapping',
    version: 1,
    name: `Fake mapping for ${sample.fileName}`,
    platform: 'unknown',
    match: { headers: header.filter(Boolean) },
  };
}

function holdingsFrom(payload) {
  const holdings = [];
  for (const { page, text } of payload.pages ?? []) {
    const asOf = /as of (\d{2})\.(\d{2})\.(\d{4})/i.exec(text);
    const date = asOf ? `${asOf[3]}-${asOf[2]}-${asOf[1]}` : '2025-12-31';
    for (const line of text.split('\n')) {
      const match = /^([A-Z]{2,6})\s+([\d][\d.,']*)/.exec(line.trim());
      if (match) {
        holdings.push({
          asset: match[1],
          quantityAsPrinted: match[2],
          asOf: date,
          platform: 'synthetic',
          page,
        });
      }
    }
  }
  return { holdings };
}

function answer(body) {
  const name =
    body.response_format?.json_schema?.name ??
    (/connection test/i.test(JSON.stringify(body.messages))
      ? 'connection_test'
      : 'unknown');
  // The data is the first user message (a repair round gets the same answer again).
  const source = body.messages?.find((m) => m.role === 'user')?.content ?? '';
  const data = (() => {
    try {
      return JSON.parse(source.slice(source.indexOf('{')));
    } catch {
      return {};
    }
  })();
  switch (name) {
    case 'mapping_spec':
      return { name, content: mappingFor(data) };
    case 'statement_holdings':
      return { name, content: holdingsFrom(data) };
    default:
      return { name, content: { ok: true } };
  }
}

createServer((request, response) => {
  if (
    request.method !== 'POST' ||
    !request.url?.endsWith('/chat/completions')
  ) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }
  let raw = '';
  request.on('data', (chunk) => (raw += chunk));
  request.on('end', () => {
    try {
      const body = JSON.parse(raw);
      const { name, content } = answer(body);
      const text = JSON.stringify(content);
      console.log(`fake-ai: ${name}`);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          model: body.model || 'fake-model',
          choices: [{ message: { role: 'assistant', content: text } }],
          usage: {
            prompt_tokens: Math.ceil(raw.length / 4),
            completion_tokens: Math.ceil(text.length / 4),
          },
        }),
      );
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'bad request' } }));
    }
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`fake-ai: OpenAI-compatible stub on http://localhost:${port}/v1`);
});
