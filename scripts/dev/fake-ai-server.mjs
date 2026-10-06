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
 * - the chat (F11.14, a request with `tools`): a scripted conversation with tool calls —
 *   "Warum fehlt der Kurs für DOT?" → list_positions → list_rates → an answer with the link;
 *   "Setz den Kurs von DOT auf 4.50 CHF" → set_price_override (a proposal card);
 *   "… Datei / Kontoauszug …" → request_file_upload; anything else → get_result. The project id
 *   and tax year come from the system prompt's context.
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

// --- F11.14: a scripted chat with tool calls (the request carries `tools`) ---

const call = (name, args) => ({
  kind: 'tools',
  calls: [{ name, args }],
});
const say = (text) => ({ kind: 'text', text });

/** Everything since the last message the user typed (an `[App] …` event is not a question). */
function currentTurn(messages) {
  let index = messages.length - 1;
  while (
    index >= 0 &&
    !(
      messages[index].role === 'user' &&
      !String(messages[index].content).startsWith('[App]')
    )
  ) {
    index -= 1;
  }
  const question = index >= 0 ? String(messages[index].content) : '';
  const results = messages
    .slice(index + 1)
    .filter((m) => m.role === 'tool')
    .map((m) => {
      try {
        return JSON.parse(m.content);
      } catch {
        return {};
      }
    });
  return { question, results };
}

function chatStep(body) {
  const system = String(
    body.messages?.find((m) => m.role === 'system')?.content ?? '',
  );
  const projectId = /\(id ([0-9a-f-]{36})/.exec(system)?.[1];
  const taxYear = /Steuerjahr (\d{4})/.exec(system)?.[1] ?? '2025';
  const { question, results } = currentTurn(body.messages ?? []);
  const asset = /\b(?:für|von)\s+([A-Za-z0-9]{2,10})\b/i
    .exec(question)?.[1]
    ?.toUpperCase();
  if (!projectId) {
    if (results.length === 0) return call('list_projects', {});
    const count = results[0]?.projects?.length ?? 0;
    return say(
      `Du hast ${count} Projekt(e). Öffne ein Projekt, dann kann ich dort nachsehen.`,
    );
  }
  // "Setz den Kurs von DOT auf 4.50 CHF" → a proposal (write tool).
  if (/setz|überschreib|ueberschreib/i.test(question) && asset) {
    const price = /(\d+(?:[.,]\d+)?)\s*(?:CHF|Fr)/i
      .exec(question)?.[1]
      ?.replace(',', '.');
    if (results.length === 0 && price) {
      return call('set_price_override', {
        projectId,
        asset,
        date: `${taxYear}-12-31`,
        priceChf: price,
        reason: 'Kurs gemäss Angabe im Chat',
      });
    }
    return say(
      results[0]?.status === 'proposed'
        ? `Ich habe die Überschreibung für ${asset} vorbereitet (${price} CHF per 31.12.${taxYear}). Bitte bestätige sie mit «Ausführen» – danach neu berechnen.`
        : `Das hat nicht geklappt: ${JSON.stringify(results[0]?.error ?? {})}`,
    );
  }
  // "Warum fehlt der Kurs für X?" → positions, then rates, then the answer with a link.
  if (/kurs/i.test(question) && asset) {
    if (results.length === 0)
      return call('list_positions', { projectId, asset });
    if (results.length === 1) return call('list_rates', { projectId, asset });
    const position = results[0]?.positions?.[0];
    const rates = results[1]?.rates ?? [];
    if (!position) {
      return say(
        `Im letzten Ergebnis gibt es keine Position ${asset}. Ist die Berechnung aktuell? [Ergebnis öffnen](/app/projects/${projectId}?tab=result)`,
      );
    }
    const why =
      position.status === 'missingPrice'
        ? `Für ${asset} ist per 31.12. kein Kurs vorhanden: Es gibt ${rates.length === 0 ? 'keine gespeicherten Kurse' : `${rates.length} gespeicherte Kurse, aber keinen innerhalb von 14 Tagen`}, keinen ESTV-Wert und keinen Override.`
        : `${asset} hat einen Kurs: ${position.priceChf} CHF (${position.priceSource ?? position.priceOrigin}).`;
    return say(
      `${why}\n\n- Position: ${position.quantity} ${asset} auf ${position.platform} – [Rückverfolgung ansehen](${position.link})\n- Du kannst den Kurs überschreiben, z. B. «Setz den Kurs von ${asset} auf 4.50 CHF».`,
    );
  }
  if (/datei|hochlad|kontoauszug/i.test(question)) {
    if (results.length === 0) {
      return call('request_file_upload', {
        projectId,
        message: 'Kontoauszug per 31.12. der Plattform',
      });
    }
    return say('Lade die Datei hier hoch – ich prüfe danach die Hinweise.');
  }
  if (results.length === 0) return call('get_result', { projectId });
  const result = results[0] ?? {};
  return say(
    `Vermögen per 31.12.: ${result.wealthChf ?? '–'} CHF, Ertrag: ${result.incomeChf ?? '–'} CHF. [Ergebnis](/app/projects/${projectId}?tab=result)`,
  );
}

let callCounter = 0;

function chatCompletion(body, raw) {
  const step = chatStep(body);
  const message =
    step.kind === 'text'
      ? { role: 'assistant', content: step.text }
      : {
          role: 'assistant',
          content: null,
          tool_calls: step.calls.map((c) => ({
            id: `call_${++callCounter}`,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        };
  console.log(
    `fake-ai: chat → ${step.kind === 'text' ? 'answer' : step.calls.map((c) => c.name).join(', ')}`,
  );
  return {
    model: body.model || 'fake-model',
    choices: [
      {
        finish_reason: step.kind === 'text' ? 'stop' : 'tool_calls',
        message,
      },
    ],
    usage: {
      prompt_tokens: Math.ceil(raw.length / 4),
      completion_tokens: 20,
    },
  };
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
      if (Array.isArray(body.tools) && !body.response_format) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(chatCompletion(body, raw)));
        return;
      }
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
