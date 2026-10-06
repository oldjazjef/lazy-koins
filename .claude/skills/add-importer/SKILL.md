---
name: add-importer
description: Support a new exchange/wallet export (Kraken ledger, Binance history, Revolut statement, ...) in lazy-koins - by writing a declarative mapping spec (JSON) to the standard format, never per-platform parser code; plus synthetic fixtures and tests. Use when a platform or file type is not recognised yet or reads wrongly.
---

# Support a platform export (mapping spec, not code)

lazy-koins has **no per-platform importer code** (decided 06.10.2026). Every export becomes the
standard format "lazy-koins Buchungen v1" either directly or through a **mapping spec**
(`libs/engine/src/mapping/mapping-spec.ts`). Supporting a platform = writing a mapping JSON.

1. **Look first.** Read `mapping-spec.ts` (every field is described) and an example under
   `libs/engine/src/mapping/fixtures/*.mapping.json`. For the shape of a real export, run
   `pnpm private:inspect` (headers and row counts only) — never open files under `private/`.

2. **Write the spec**: `match.headers` (the fingerprint — enough columns to tell it from the
   platform's other exports), `source.headerRow`/`sheet` if the header is not found by search,
   `bookings.timestamp` (format + zone; `timeZoneFromFileName` when the name says it),
   `quantity` (signed / inOut / side), `fee` (+ `assetColumn`), `kind.rules` (first match wins;
   anything unmapped stays `unknown` — never drop rows), `assets` (rewrites, aliases), `filters`
   (e.g. pending duplicates), optional `holdings`. State the source's time zone in `description`.

3. **Try it** on a file in the app (mapping editor → "Prüfen") or with
   `POST /api/projects/:id/files/:fileId/mapping-preview` and `{ "spec": … }`; save it with
   `POST /api/mappings`. Users can download/upload mappings as `.json`.

4. **Test it** (when it belongs in the repo as an example): a **synthetic** fixture next to the
   spec in `libs/engine/src/mapping/fixtures/` — copy the _shape_ (headers, quirks, odd rows) of
   a real export, never values, addresses, txids or account ids from `private/` — and cases in
   `apply-mapping.spec.ts`: matching (yes + the nearest lookalike no), every kind, fees, a
   multi-leg trade (`group`), row numbers, 18-decimal quantities kept exactly.

5. If the spec language cannot express a format, extend the spec (schema + `applyMapping` +
   tests, bump nothing unless it breaks old specs) — still no platform-specific branch in code.
   Then `pnpm check`, and — if `private/` exists — the golden test (A1).
