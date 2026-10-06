#!/usr/bin/env node
/**
 * Loads the user's own exports into the running dev API: project "Steuern 2025" (year 2025, CH)
 * for the dev user anna@lazykoins.dev, every mapping JSON from <dir>/mappings first, then every
 * CSV/XLSX/PDF found recursively under <dir> (except <dir>/reference/**), then "Kurse
 * aktualisieren" and the calculation.
 *
 * Prints only per-file status (name, status, record count) and the two headline totals — never
 * rows, values of single records or file content (CLAUDE.md, Private data).
 *
 * Needs the API running with AUTH_MODE=dev (`pnpm start:full` or `pnpm start:api`).
 *
 * Usage:
 *   pnpm private:load            # canton ZH
 *   pnpm private:load BE         # canton BE (or LK_CANTON=BE)
 *
 * Environment:
 *   LK_PRIVATE_DIR   folder to read (default: <repo>/private)
 *   LK_API_URL       API base (default: http://localhost:3333/api)
 *   LK_USER          dev user e-mail (default: anna@lazykoins.dev)
 *   LK_PROJECT_NAME  project name (default: Steuern 2025)
 *   LK_TAX_YEAR      tax year (default: 2025)
 *   LK_SKIP_RATES=1  skip the rate refresh (offline)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const dir = path.resolve(
  process.env.LK_PRIVATE_DIR ?? path.join(repo, 'private'),
);
const api = (process.env.LK_API_URL ?? 'http://localhost:3333/api').replace(
  /\/$/,
  '',
);
const user = process.env.LK_USER ?? 'anna@lazykoins.dev';
const projectName = process.env.LK_PROJECT_NAME ?? 'Steuern 2025';
const taxYear = Number(process.env.LK_TAX_YEAR ?? '2025');
const canton = (process.argv[2] ?? process.env.LK_CANTON ?? 'ZH').toUpperCase();
const auth = { Authorization: `Bearer dev:${user}` };

const UPLOADS = new Set(['.csv', '.xlsx', '.pdf']);

function fail(message) {
  console.error(`private:load: ${message}`);
  process.exit(1);
}

async function call(method, route, { json, bytes, query } = {}) {
  const url = new URL(`${api}${route}`);
  for (const [key, value] of Object.entries(query ?? {}))
    url.searchParams.set(key, value);
  const headers = { ...auth };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (bytes !== undefined) {
    headers['Content-Type'] = 'application/octet-stream';
    body = bytes;
  }
  let response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch {
    fail(
      `the API at ${api} is not reachable — start it with \`pnpm start:full\``,
    );
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, ok: response.ok, data };
}

/** Error text of an API answer — the API's own message, never a file's content. */
function reason(answer) {
  const message = answer.data?.message;
  return Array.isArray(message)
    ? message.join('; ')
    : (message ?? `HTTP ${answer.status}`);
}

function walk(folder, relative = '') {
  const out = [];
  for (const name of readdirSync(folder).sort()) {
    const full = path.join(folder, name);
    const rel = relative ? `${relative}/${name}` : name;
    if (statSync(full).isDirectory()) {
      if (rel === 'reference' || rel === 'mappings') continue;
      out.push(...walk(full, rel));
    } else if (UPLOADS.has(path.extname(name).toLowerCase())) {
      out.push({ full, rel });
    }
  }
  return out;
}

const chf = (value) => {
  if (value === null || value === undefined) return '–';
  const [int, frac = ''] = String(value).split('.');
  const negative = int.startsWith('-');
  const digits = negative ? int.slice(1) : int;
  const cents = `${frac}00`.slice(0, 2);
  return `${negative ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '’')}.${cents}`;
};

async function main() {
  try {
    if (!statSync(dir).isDirectory()) fail(`${dir} is not a folder`);
  } catch {
    fail(`${dir} does not exist`);
  }

  // 1. The project (reused when it exists).
  const projects = await call('GET', '/projects');
  if (!projects.ok)
    fail(`cannot list projects (${reason(projects)}) — is AUTH_MODE=dev?`);
  let project = projects.data.find(
    (p) => p.name === projectName && p.taxYear === taxYear,
  );
  if (project) {
    console.log(`Projekt „${project.name}“ wird weiterverwendet.`);
    if (project.status === 'closed')
      fail('the project is closed — reopen it first');
  } else {
    const created = await call('POST', '/projects', {
      json: { name: projectName, taxYear, country: 'CH', canton },
    });
    if (!created.ok) fail(`cannot create the project (${reason(created)})`);
    project = created.data;
    console.log(`Projekt „${project.name}“ angelegt (Kanton ${canton}).`);
  }

  // 2. Mappings first, so the uploads are read with them.
  const mappingDir = path.join(dir, 'mappings');
  let mappingFiles = [];
  try {
    mappingFiles = readdirSync(mappingDir)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .sort();
  } catch {
    mappingFiles = [];
  }
  const existing = (await call('GET', '/mappings')).data ?? [];
  for (const name of mappingFiles) {
    let spec;
    try {
      spec = JSON.parse(readFileSync(path.join(mappingDir, name), 'utf8'));
    } catch {
      console.log(`  Mapping ${name}: kein gültiges JSON`);
      continue;
    }
    const same = existing.find(
      (m) => m.name === spec.name && m.platform === spec.platform,
    );
    const answer = same
      ? await call('PUT', `/mappings/${same.id}`, { json: { spec } })
      : await call('POST', '/mappings', { json: { spec, origin: 'manual' } });
    if (!answer.ok) {
      console.log(`  Mapping ${name}: abgelehnt (${reason(answer)})`);
      continue;
    }
    const id = answer.data.id ?? answer.data.mapping?.id;
    if (same && id) await call('POST', `/mappings/${id}/reapply`, { json: {} });
    console.log(`  Mapping ${name}: ${same ? 'aktualisiert' : 'gespeichert'}`);
  }

  // 3. Every export file.
  const files = walk(dir);
  console.log(`\n${files.length} Dateien:`);
  for (const file of files) {
    const bytes = readFileSync(file.full);
    const answer = await call('POST', `/projects/${project.id}/files`, {
      bytes,
      query: { name: path.basename(file.rel) },
    });
    const entry = answer.status === 409 ? answer.data?.existing : answer.data;
    if (!answer.ok && !entry) {
      console.log(`  ${file.rel}: Fehler (${reason(answer)})`);
      continue;
    }
    const records = (entry.bookingCount ?? 0) + (entry.holdingCount ?? 0);
    console.log(
      `  ${file.rel}: ${entry.status}${answer.status === 409 ? ' (schon im Projekt)' : ''}, ${records} Datensätze${entry.errorCount ? `, ${entry.errorCount} Zeilenfehler` : ''}`,
    );
  }

  // 4. Rates, then the calculation.
  if (process.env.LK_SKIP_RATES !== '1') {
    console.log('\nKurse aktualisieren …');
    const refreshed = await call(
      'POST',
      `/projects/${project.id}/rates/refresh`,
      {
        json: {},
      },
    );
    if (refreshed.ok) {
      const counts = {};
      for (const asset of refreshed.data.assets)
        counts[asset.status] = (counts[asset.status] ?? 0) + 1;
      console.log(
        `  Devisen: ${refreshed.data.fx} Tage; Assets: ${
          Object.entries(counts)
            .map(([status, n]) => `${n} ${status}`)
            .join(', ') || 'keine'
        }`,
      );
    } else {
      console.log(`  übersprungen (${reason(refreshed)})`);
    }
  }
  const result = await call('POST', `/projects/${project.id}/calculate`, {
    json: {},
  });
  if (!result.ok) fail(`calculation failed (${reason(result)})`);
  const totals = result.data.result.totals;
  console.log(`\nVermögen per 31.12.${taxYear}: CHF ${chf(totals.wealthChf)}`);
  console.log(`Ertrag ${taxYear}: CHF ${chf(totals.incomeChf)}`);
  console.log(
    `${totals.positions} Positionen, ${totals.missingPrices} ohne Kurs, ${totals.openItems} offene Punkte.`,
  );
  console.log(`\nIm Browser: /app/projects/${project.id}`);
}

await main();
