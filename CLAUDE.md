# lazy-koins

Turns exports from crypto exchanges and wallets into the tax documents for one tax year: **wealth
at 31.12.** and **income**, as a simple and a detailed statement (PDF + Excel). First country:
Switzerland, private assets. Requirements: **[ANFORDERUNGEN.md](ANFORDERUNGEN.md)** (cite them as
`F7.5`, `A1`, …); tax rules: `docs/FACHREGELN.md`.

Two ways to run it with the **same features** (F1): a multi-user **web app** and a single-user
**desktop app** (macOS + Windows, no login, data stays on the machine). A project moves between the
two as a package (F1.3).

> **Status (08.10.2026): files + mappings + AI plugin + calculation + dashboard / carry-over /
> packages.** Nx monorepo with the NestJS API
> (`apps/api`: auth, users, **projects** = F4.1/F4.2/F4.5 basics, **files** = F5.1–F5.8
> storage/upload/preview, **mappings** = declarative mapping specs, **ai** = F5.13/F5.14: AI-written
> mappings and PDF statements read into balances, **calculation / rates / settings / exports** =
> F7–F11 on top of the engine, **dashboard** = F11.4–F11.9, **carryover** = F4.4/F4.4a,
> **packages** = F10.8/F10.9, data export F10.7), the Angular web app (`apps/web`: login, the
> **Dashboard** (start page, first in the main navigation), project
> list with Vermögen/Ertrag, the project **workspace** with tabs Dateien · Kurse · Ergebnis ·
> Prüfungen · Korrekturen · Exporte; the global **Mappings** page = F11.0 in the main navigation;
> Profil and Einstellungen › Kurse/Wallets/AI behind the user menu), the pure engine (`libs/engine`:
> money helpers, `Booking`/`Holding`, the **standard format "lazy-koins Buchungen v1"**, the
> **mapping spec** and its applier, F5.8 coverage hints, the **calculation** with rates, checks,
> corrections and analyses over any date, the golden test) and the infrastructure
> — ported from `surf-lend`. When in doubt about a convention, look at how surf-lend does it.
> **No per-platform importer code** (decided 06.10.2026): every platform is a mapping spec (JSON,
> stored per user). **Desktop app** (`apps/desktop`, Electron, see Desktop) and the **release /
> deploy pipeline** (`deploy/`, `.github/workflows/`) exist. **Not built yet:** bookings persisted
> as rows, wallet lookups (F6) — wallets are no entity yet, so the follow-up project shows that group
> disabled. Update this file whenever the code makes a section concrete or wrong.

## Stack

Same as surf-lend, minus mobile/Capacitor, Stripe, Firebase push, maps and analytics; plus
Electron for the desktop app (**Electron 42** + electron-builder, see Desktop).

### Shared

|                 |                                                                          |
| --------------- | ------------------------------------------------------------------------ |
| Node            | **22.23.2**, pinned via Volta in `package.json`                          |
| Package manager | **pnpm 11.21.0**, pinned via `packageManager` — do not use npm           |
| Nx              | 23.1.1 (exact; `@nx/devkit` is pinned to match in `pnpm-workspace.yaml`) |
| TypeScript      | 6.0.3                                                                    |
| Tests           | **Vitest** everywhere — one runner for every project                     |
| Numbers         | **decimal.js** for every quantity, price and CHF amount — see Numbers    |

### App (`apps/web`)

|         |                                                                                       |
| ------- | ------------------------------------------------------------------------------------- |
| Angular | 22.1, **standalone + zoneless**, esbuild (`@angular/build`)                           |
| UI      | **spartan.ng** — `@spartan-ng/brain` + generated "helm" components in `libs/ui`       |
| Styling | **Tailwind CSS v4** (CSS-first, `.postcssrc.json`) + token values in `src/styles.css` |
| Forms   | Typed reactive forms, validated with **Zod** (messages are i18n keys)                 |
| Data    | `httpResource` for reads, the **ActionRunner** for mutations                          |
| i18n    | **ngx-translate** v18, runtime JSON — `public/i18n/de-CH.json` (the only locale)      |
| Auth    | **Firebase Authentication** with the Firebase JS SDK (`firebase/auth`), lazy-loaded   |
| Font    | Inter, self-hosted via `@fontsource-variable/inter`                                   |

### API (`apps/api`)

|          |                                                                                             |
| -------- | ------------------------------------------------------------------------------------------- |
| NestJS   | 11, default Express adapter                                                                 |
| Database | **SQLite** — one file (`DATABASE_URL=file:…`), also what the desktop app will use           |
| ORM      | **Prisma 7** with `@prisma/adapter-better-sqlite3`, client generated as `cjs`               |
| Schema   | **migration history** in `prisma/migrations`; `migrate deploy` applies it — no `db push`    |
| CQRS     | `@nestjs/cqrs` — one handler per operation, events for side effects                         |
| OpenAPI  | `@nestjs/swagger` builds the document, **Scalar** renders it                                |
| Auth     | **Resource server only**: verifies Firebase ID tokens (firebase-admin). It issues no tokens |
| Validate | DTOs with `class-validator` + `class-transformer`                                           |
| Build    | webpack via `@nx/webpack`                                                                   |
| Tests    | Vitest with `unplugin-swc`                                                                  |

Frontend rules: no `zone.js`, no NgModules, no Material. `input()`/`output()`/`signal()` and
`inject()` — that last rule is **frontend only**; Nest uses constructor injection.

## Commands

Run from the repo root.

```bash
pnpm start:full    # pending migrations, then API + web in one terminal  <- the usual way
pnpm start         # nx serve web  -> http://localhost:4200 (proxies /api to :3333)
pnpm start:api     # nx serve api  -> http://localhost:3333/api, reference at /api/reference
pnpm check         # THE gate (= ci:verify): lint + budget + format + test + build + typecheck
pnpm test          # all unit tests (root Vitest workspace — not via Nx, see Testing)
pnpm test:integration  # specs that need a real database (against tmp/lazykoins-test.db)
pnpm ci:integration    # fresh test database: reset, db:deploy, test:integration
pnpm format        # prettier --write .
pnpm build         # nx build web          (pnpm build:api = nx build api)
pnpm start:desktop # desktop app in dev: builds web + API bundle, stages, starts Electron
pnpm build:desktop # packages the desktop app for this OS into dist/desktop (LK_VERSION=v1.2.3)
pnpm version:info  # the build version (X.Y.Z+<commit>), see Versions and icons
pnpm icons         # regenerate every icon from assets/brand/icon.svg

pnpm db:deploy     # prisma migrate deploy — applies pending migrations, safe on real data
pnpm db:migrate    # prisma migrate dev — AUTHORS a migration (read Database first)
pnpm db:seed       # anna@lazykoins.dev + two sample projects (local databases only)
pnpm db:studio     # prisma studio — browse the database

pnpm private:inspect   # structure of private/ (paths, sizes, headers, row counts) — never rows
pnpm private:load [ZH] # loads private/ into the RUNNING dev API: project "Steuern 2025", mappings,
                       #   files (not private/reference/**), rates, calculation — prints totals only
pnpm exec playwright-core install chromium   # once: the browser for PDF exports
pnpm vitest run --project engine   # one project's tests (api, web, engine, eslint-rules)
```

First run: `cp apps/api/.env.example apps/api/.env`, `pnpm install`, `pnpm db:deploy`,
`pnpm db:seed`, `pnpm start:full`, then sign in as `anna@lazykoins.dev` (dev auth, see Auth). No
Docker, no Firebase project needed.

`pnpm install` also runs `prepare`: `git config core.hooksPath .githooks` (the private/ guard,
skipped outside a git checkout) and `prisma generate`.

**The Nx daemon is disabled** (`useDaemonProcess: false`): its cold start costs minutes on Windows
and buys nothing at this size. If `nx` seems to hang, check that.

## Layout

```
apps/api/                   # NestJS API — the web app's backend AND the desktop app's in-process server
  prisma/schema.prisma      #   the schema; prisma/migrations = the history (CHECKs hand-written)
  webpack.desktop.config.js #   the API as a CommonJS library for the desktop (nx run api:build-desktop)
  src/
    main.ts                 #   server entry point: just `bootstrap()`
    bootstrap.ts            #   bootstrap(options): /api prefix, helmet, validation, CORS, OpenAPI; 127.0.0.1 in local mode
    desktop.ts              #   desktop entry: exports bootstrap, starts nothing
    config/env.ts           #   the validated environment — the process refuses to boot on a bad value
    common/throttling/      #   per-IP + per-account rate limits
    persistence/            #   the ONLY code that touches Prisma
      persistence.module.ts #     binds every repository port to its adapter (global)
      prisma/               #     PrismaService, sqlite-url, mappers, repositories/*.prisma.repository.ts
    integrations/           #   the ONLY code that touches firebase-admin; dev + local verifiers
      ai/                   #     AiCompletionPort + OpenAI-compatible / Anthropic adapters (plain fetch)
      rates/                #     Binance klines, CoinGecko, Frankfurter (ECB) — serialised, no key in logs
      pdf/                  #     PlaywrightPdfRenderer (Chromium, lazily started)
    auth/                   #   AccessTokenGuard (global), PrincipalService, @Public, @CurrentUser
    users/                  #   GET /api/me
    projects/               #   the reference feature slice — copy its shape
    files/                  #   F5: upload (raw body), list, download, preview, assignment, templates
      application/          #     handlers, FileAnalysisService (engine runs), SourceFileReader (exceljs)
    mappings/               #   mapping specs: CRUD, JSON download, schema, project listing, usage (F11.0)
    ai/                     #   F5.13/F5.14: settings, payload preview, AI mappings, PDF statements
      domain/               #     pure: sample builder, prompts, repair logic, statement checks, SSRF guard
    calculation/            #   F7–F9: input assembly + hash, calculate/result/drill-down, checks + open
                            #   items, corrections (undo/redo); testing/calculation-fixture.ts
    rates/                  #   F7.4: stored rates per project, refresh (ports), overrides, ESTV import
    settings/               #   F11 profile data + CoinGecko/Etherscan keys (sealed), online rates on/off
    exports/                #   F10: Excel (ExcelJS, formulas) + HTML → PDF, stored exports, mail draft,
                            #   data export in the standard format (F10.7, data-export.handlers.ts)
    dashboard/              #   F11.4–F11.9: input across all projects, cache per input hash, user rate cache
    carryover/              #   F4.4a follow-up project, F4.4 take-over, ProjectBundle (one transaction)
    packages/               #   F10.8/F10.9: .lkproj.zip / account package (fflate), manifest + verification
    common/crypto/          #   SecretBox (AES-256-GCM, SETTINGS_ENCRYPTION_KEY)
    common/http/            #   RawBodyMiddleware (uploads), contentDisposition()
    openapi/                #   document + Scalar
apps/web/                   # Angular app
  public/env.js             #   runtime configuration (window.__LK_ENV__) — see Runtime configuration
  public/i18n/de-CH.json    #   messages
  src/styles.css            #   the ONLY place colours live (light + dark)
  src/app/
    core/                   #   actions/, api/, auth/, config/, i18n/, layout/, notifications/, theme/
    features/<feature>/     #   login, dashboard (page + project card), projects (+ follow-up page),
                            #   mappings (F11.0: list + detail), profile (+ account package), settings
                            #   (shell + rates/wallets/ai), files and calculation (components only:
                            #   embedded in the project detail; project-workspace hosts the tabs, its
                            #   service is shared by them; ai-assist = the AI dialogs; mapping-editor =
                            #   the editor body, also used by mappings)
    shared/format/          #   formatChf / formatQuantity + lkChf / lkQuantity pipes (de-CH, decimal.js)
    shared/ai/              #   aiErrorKey — the API's AI error codes → `ai.errors.<code>`
    shared/files/           #   saveBlob / fileNameFrom — authenticated downloads; filesByPlatform
    shared/charts/          #   hand-rolled SVG: lk-line-chart, lk-sparkline, lk-allocation-bar (no chart lib)
    shared/components/      #   records-dialog = the F7.5 drill-down (workspace + dashboard), empty-state, …
    shared/                 #   components/<c>/index.ts, forms/zod-validator
apps/desktop/               # Electron shell (see Desktop)
  src/main/                 #   main.ts (lifecycle, window, IPC, storage switch), api-host.ts, protocol.ts (app://)
    lib/                    #   PURE helpers, unit-tested without Electron: migrations, storage, lock-file,
                            #   sync-folder, web-protocol (routing, CSP, env.js), api-env
  src/preload/preload.ts    #   window.lazykoinsDesktop (contextBridge) — types in src/shared/bridge.ts
  scripts/                  #   stage.mjs (assemble dist/apps/desktop-app), native-deps.cjs
  electron-builder.config.cjs, build/icon.png
libs/engine/                # PURE TypeScript (@lazykoins/engine), no Nest/Angular/Prisma/network/fs/clock
  src/money/                #   decimal.js helpers: parseDecimal (strings only), roundTo, format*
  src/bookings/booking.ts   #   Booking, Holding, BookingKind (the closed list of the standard format)
  src/importers/            #   importer.ts (Importer, SourceFile, ImportResult) + registry.ts + table.ts
    text/                   #     pure decoding: bytes→text (UTF-8/16, cp1252), CSV, numbers, timestamps
  src/standard/             #   standard format v1: German columns, zod row validation, template content
  src/mapping/              #   mapping spec (zod, JSON Schema export) + applyMapping + fingerprints
    fixtures/               #     SYNTHETIC exports + example mapping JSON (test data, not product code)
  src/coverage/             #   coverage per platform/account + F5.8 missing-file hints
  src/rules/                #   CountryRules (F7.7): chRules — thresholds, pegged assets, labels (F10.3)
  src/rates/                #   RateTable, unitPriceChf (price priority), yearlyAverageChf, Kursliste
  src/corrections/          #   correction schema (zod) + applyCorrections (before/after)
  src/calculation/          #   calculate() (F7/F8), balances.ts, analysis.ts (any date / range), records.ts
  src/dashboard/            #   dashboard() (F11.5–F11.8) + the cross-project rules (yearOwner, …)
  src/standard/standard-export.ts # F10.7: records → standard rows + info columns (round trip)
  src/golden/golden.spec.ts #   A1 against private/golden.json — skips when absent
libs/ui/<component>/        # spartan helm components (GENERATED — vendored)
tools/eslint-rules/         # workspace lint rules (Prisma boundary, no hardcoded text/design values)
scripts/                    # lint budget, private-inspect, dev/ (test-db wrapper, seed, hooks), build/
assets/brand/icon.svg       # THE app icon source (pnpm icons → desktop + web icons)
deploy/                     # Coolify: README (secrets + variables by name), coolify/SETUP.md + lazykoins.yml,
                            #   deploy.sh, smoke-test.sh
private/                    # REAL tax data + golden.json — git-ignored, see Private data
```

Exports live in the API (`exports/`), not in a library.

The engine is a library so the API, the desktop app and the tests run **the same calculation**.

## Persistence architecture (API)

Same four layers as surf-lend / etx, each arrow a replaceable seam. Copy the shape of `projects/`.

```
Controller → Service façade → CommandBus / QueryBus → Handler (business logic)
                                                        → Repository Port (contract + domain types)
                                                          → Prisma adapter (the only Prisma code)
```

1. **Nothing outside `src/persistence/` imports Prisma** (`@nx/workspace-no-direct-prisma-access`),
   and **nothing outside `src/integrations/` imports `firebase-admin`** (`no-restricted-imports`
   in `apps/api/eslint.config.mjs`). Features depend on ports.
2. **Ports are `abstract class`** — contract and DI token in one. Bindings live in
   `PersistenceModule` / `IntegrationsModule`, never in a feature module.
3. **Domain types are hand-written** in each feature's `domain/`. Never re-export a Prisma model.
4. **Ports take declarative criteria**, never `where` objects.
5. **Scalars cross the boundary as**: timestamps = ISO 8601 strings; quantities and amounts (from
   the first booking on) = **decimal strings**. `persistence/prisma/mappers/` is the only place
   that converts.
6. **Business logic lives in handlers**; Nest HTTP exceptions are thrown there.
7. **Side effects are events** (none yet).
8. **Ownership is checked in the handler** (`projects/application/project-access.ts`,
   `loadOwnProject`): someone else's project is a **404**, exactly like a missing one.

Handler specs run against **port doubles** — real in-memory implementations of the port
(`projects/testing/in-memory-project.repository.ts`), not ORM mocks. There is no tenant scoping
and no `AsyncLocalStorage`: every handler receives the acting user id in its command/query.

## Files and mappings (F5)

The **single input model** is the standard format "lazy-koins Buchungen v1"
(`libs/engine/src/standard/`): **Buchungen** (Zeitpunkt with zone → UTC, Plattform, Konto, Art from
the closed `BOOKING_KINDS`, Asset, signed Menge, Gebühr + Gebühr-Asset, Preis CHF/USD, Referenz =
trade group, Notiz) and **Bestände** (Plattform, Konto, Asset, Menge, Stichtag, prices, Beleg).
CSV holds one record type (recognised by its header); XLSX has a `Buchungen` and a `Bestände`
sheet. Templates: `GET /api/standard-format/template.csv?type=bookings|holdings` and
`template.xlsx` (explanation sheet, examples, number columns as text, a list for `Art`).

Every other export is read through a **mapping spec** (`libs/engine/src/mapping/mapping-spec.ts`,
zod, every field described so `GET /api/mappings/schema` can go into an LLM prompt): fingerprint
(`match.headers` + optional file-name regex), header row below a preamble, delimiter/encoding,
date format + zone (fixed, IANA, or from the file name), sign rules (signed / in-out / side),
fee + fee asset, kind lookup rules (first match wins, default `unknown` — rows are never dropped),
asset rewrites + aliases, exclude filters, balances (`rows` or `lastPerAsset` from a running
balance column). `applyMapping` is pure and deterministic; every record keeps `sourceFileId` (the
SHA-256), the 1-based row and the raw row (F7.5). Bad rows become `errors` with row + column.

Upload flow (`files/application/commands/upload-project-file.command.ts`): kind from the bytes
(`%PDF-`, ZIP with `xl/`, text) → SHA-256 → duplicate in the same project = **409** with
`existing` → standard format, else the owner's mappings by fingerprint (standard wins; among
mappings: surest, then most recently changed) → status `standard | mapped | needs_mapping`; a PDF
is `evidence_only`. Same bytes in another project of the owner: stored once, origin
`from_project:<id>`. Only counts, period and per-account **coverage** are stored on the
`project_file` row — bookings are not persisted as rows yet. F5.8 hints are computed from that
coverage (`coverage/missing-files.ts`), no platform knowledge.

Mappings are owner-scoped (`import_mapping`); a project lists the mappings its files use. Editing
one does not touch files until the user confirms `POST /api/mappings/:id/reapply` (closed projects
are skipped). Deleting one resets its files to `needs_mapping` in the same transaction.

**Mappings page (F11.0)** — `features/mappings`, `/app/mappings` in the main navigation: every
mapping of mine (`GET /api/mappings` adds `filesUsing` / `projectsUsing`, counted by the
database via `ProjectFileRepositoryPort.countByMappings`), search + sort, upload `.json`, new.
`/app/mappings/:id`: facts, JSON, edit (the shared `lk-mapping-editor-form`, preview against a
file that uses it — any project), save → offer re-apply, download, delete (lists the affected
files; disabled while a closed project uses it — the API's 409), and "Wird genutzt in"
(`GET /api/mappings/:id/usage`: projects newest year first, files linking to
`/app/projects/:id#file-<id>`, where the row is scrolled to and marked). The project's mappings
section only lists the mappings its files use (linking here), uploads a `.json`, starts
"Mit AI erstellen" and the editor of a new mapping for one file; edits happen on this page. After
a save from a project (editor, upload, AI) the toast links to the new mapping's page.

To support a new platform: write (or let the AI write — "Mit AI erstellen") a mapping JSON, check it with the
preview (`POST …/files/:id/mapping-preview` with `spec`), save it. For a test, add a synthetic
fixture + mapping JSON under `libs/engine/src/mapping/fixtures/` (skill `add-importer`).

## AI plugin (F5.13, F5.14)

Optional: without it everything works with the template and hand-written mappings. Settings per
user in **`ai_settings`** (own table/migration `20261007090000_ai_settings`): on/off, provider kind
`openai_compatible | anthropic`, base URL, model (empty = provider default), the API key **sealed
with AES-256-GCM** (`common/crypto/secret-box.ts`, key = SHA-256 of `SETTINGS_ENCRYPTION_KEY`;
empty env = no key can be stored, keyless local models still work), never returned (hint `…1234`),
and the consent timestamp. Web: **Einstellungen → AI** (`/app/settings/ai`), presets, connection
test (`POST /api/ai/settings/test`, no user data).

- **Port**: `integrations/ai/ai-completion.port.ts` (`AiCompletionPort.complete(connection,
request)` → parsed JSON + text + usage). `ProviderSwitchingAiCompletion` dispatches per call:
  OpenAI-compatible Chat Completions (`response_format: json_schema`, on 400/422 retried as plain
  JSON in the text — older Ollama, gateways) and Anthropic Messages (forced **tool use** with the
  schema as `input_schema`, `anthropic-version: 2023-06-01`, default `claude-sonnet-5-5`). Plain
  `fetch`, 120 s timeout, errors mapped to codes (`invalidKey` 401/403, `rateLimited` 429,
  `modelNotFound` 404, `network`, `timeout`, `badResponse`, `providerError`) → 502 with `code`.
- **Gate** (`ai/application/ai-gate.ts`): 409 `aiDisabled | aiNotConfigured | consentRequired |
keyUnreadable | privateUrl`. **Consent (F5.14)**: `GET …/ai/{mapping|statement}/payload` returns
  exactly the data that will be sent; the app shows it before EVERY request; the first request
  needs `consent: true` and stores `consent_at` (revocable in the settings).
- **Precise error details** (user rule: "genaue Fehlerinfos"): `AiProviderError(code, details)`
  — `postJson` (`integrations/ai/ai-http.ts`) fills `status`, the provider's own
  `providerMessage` / `providerType` / `providerCode` (OpenAI `error.{message,type,code}`,
  Anthropic `error.{type,message}`, Ollama `error` string, an HTML page → its text), `url`
  (scheme://host/path, never the query), `model`, and for transport failures the system `cause`
  (`ECONNREFUSED`, `ENOTFOUND (host)`, TLS codes — undici hides them in `cause`, sometimes an
  `AggregateError`) or `timeoutMs`. `AiGate.call(work, connection)` puts them into the 502 body
  next to `code` plus a one-line `detail`, and logs that line at warn. **Everything passes
  `redactSecrets`** (`integrations/ai/redact.ts`): every non-public header value of the request,
  the connection's key again in the gate, `Bearer …`, `sk-…`, `x-api-key/api_key/token=…`, cut
  to 500 characters. 409s from the gate carry a human `detail` (what is missing). Web:
  `shared/ai/ai-error-details.ts` (`aiErrorInfo` + a hint per typical case) and
  `lk-ai-error-panel` (summary, hint, details list, "Details kopieren"; `collapsible` in the AI
  dialogs) — the settings test shows it under the buttons, the AI dialogs above their footer.
- **SSRF guard**: the API itself calls the base URL, so private/loopback hosts are refused unless
  `AI_ALLOW_PRIVATE_URLS=true` — default: allowed with `AUTH_MODE=local|dev`, refused with
  `firebase`. Literal host check only (no DNS-rebinding protection).
- **Mapping** (`POST /api/projects/:p/files/:f/ai/mapping`): sample (`ai/domain/mapping-sample.ts`:
  file name, encoding, delimiter guessed over the first 30 lines, first ≤25 raw rows incl.
  preamble — up to 40 with a long preamble — distinct values of category-like columns ≤40, row
  count; never amounts/dates/ids as "distinct values") → system prompt with the standard format,
  kinds and a condensed copy of `docs/FACHREGELN.md` (`ai/domain/prompts.ts` — keep in step) →
  zod (`validateMappingSpec`) → **dry run of `applyMapping` on the whole file** → if invalid,
  header not found, no records, >5 % row errors or >20 % `unknown`: **one** repair round with the
  concrete problems (it quotes no cell the sample did not show) → candidate with preview, kind
  counts, unknown values, token usage. Nothing saved: `…/ai/mapping/accept` with the reviewed spec
  stores an `import_mapping` with origin `ai` and reads the file with it; later files with the same
  fingerprint are mapped on upload without AI.
- **PDF statements** (`…/ai/statement`): text per page with **pdfjs-dist** (legacy build,
  `files/application/pdf-text-extractor.ts`; ≤12 pages / 40 000 characters sent) → the model returns
  Bestände with `quantityAsPrinted` (JSON Schema from zod) → textual normalisation (never via a JS
  number; `1,234` flagged ambiguous) + **verbatim check** of every printed quantity against the
  text (whole-number match, page checked) → review table. `…/statement/accept` takes the records
  as returned, re-extracts and re-checks on the server and stores a **derived standard-format CSV**
  (`<name>.bestaende.csv`, `Beleg` = `<pdf>, S. <n>`, origin `derived_from:<project file id>`);
  the PDF stays as evidence. No mapping is stored.
- Live without an account: `node scripts/dev/fake-ai-server.mjs` (OpenAI-compatible stub on
  `http://localhost:11435/v1`; answers the synthetic fixtures' mappings and simple statements).

## Calculation, rates, checks, corrections, exports (F7–F10)

**Engine** (`libs/engine/src/calculation/calculate.ts`, pure): `calculate(input)` takes the
standard records of all project files, the active corrections, the stored rates, the country
rules, the tax year and (optionally) the previous year's closing positions, and returns a JSON
result — amounts as decimal strings, every figure with the `recordIds` behind it (F7.5) and a
`records` map that resolves them to file (SHA-256) + row.

- **Positions at 31.12.** (F7.1) per platform/account/asset: an account with **statement**
  holdings dated 31.12. takes them for the whole account (several rows of one asset add up — `DOT`
  - `DOT.S`); otherwise the **ledger** Σ quantity − Σ fee (a fee in another asset reduces that
    asset) over every booking before 01.01. of the next year. Holdings from a file that also has
    bookings for that account are a ledger's **running balance** (mapping `lastPerAsset`): never
    preferred, only checked. Manual holdings (corrections) replace their asset. |q| < 1e-7 dropped;
    spam (name matches `claim`, or a `spam` booking) and negative positions stay listed but are not
    in the total.
- **Price priority** (`rates/rate-table.ts` `unitPriceChf`): CHF = 1 → override (`manual` rate,
  F9.1/F7.4) → ESTV (same day) → the record's CHF price → the record's USD price × USD/CHF →
  stablecoins/USD = 1 USD × USD/CHF, EUR via EUR/CHF → stored CHF price → stored USD price ×
  USD/CHF; prices at most 14 days before, else at most 14 days after; FX forward-filled.
- **Income** (F7.2) of the year at arrival (UTC day), **net** after a fee in the same asset, gross
  as info. A booking with its own USD value (`valueUsd`/`feeValueUsd`, mapping fields — Kraken
  `amountusd`/`feeusd`) is valued `(valueUsd − feeValueUsd) × USD/CHF of the day`.
- **Earn gap** for every account with statement balances at both year ends and bookings in the
  year: `(end − start) − Σ bookings without transfers`; positive → income at the yearly average
  (daily USD × USD/CHF), negative → open item; EUR, USDT excluded (country rules).
- **Checks** (F8.1) with lights + **open items** with a stable `key`, reason, params and CHF
  impact (F8.2): ledger = statement (exact) + running-balance consistency + negative balances,
  Earn gap, withdrawals ↔ deposits across own accounts (±2 %, −1 h … +7 d, fiat ignored), opening =
  previous closing, missing prices, unclassified bookings, wallet networks (placeholder, yellow).
- `analysis.ts`: `balancesAt`, `dailyBalances` (one sweep), `flowsBetween`, `dailyPricesChf` —
  the same rules for any date/range (for the dashboard).

**API**: `calculation/` assembles the input from storage (files are **read again** from their
bytes with the standard importer or their mapping; bookings are not rows) and hashes what decides
the result (file SHA-256s + mapping versions, corrections, rates, previous snapshot, engine
version) → `stale` without reading files. `POST /projects/:id/calculate` stores a snapshot;
`GET …/result`, `GET …/result/records?figure=<id>` (pos:, inc:, gap:, evt:, plat:, cat:, item
key), `GET …/checks`, `PATCH …/open-items`, `GET|POST …/corrections`, `…/corrections/:id/undo|redo`.
Closed projects: 409 for calculate, corrections, ticks, rate changes; exports stay allowed (the
final statement) and use the last snapshot. `rates/`: `POST …/rates/refresh` (ECB via
Frankfurter, Binance `<SYM>USDT`/`BUSD` daily closes, CoinGecko CHF with the user's key as
fallback; renamed assets via `RATE_ALIASES`; a series that already covers the year is skipped
unless `force`), `PUT|DELETE …/rates/manual`, `POST …/rates/estv` (raw file body). Refused (409)
when the user switched rate lookups off or `RATES_ONLINE=false`. `exports/`: `POST …/exports`
recalculates first when stale; detailed Excel = the FACHREGELN sheets with formulas (named cells
`USDCHF`/`EURCHF`, value per position by price priority, SUMIFS), PDF = HTML printed by Chromium
(`PdfRendererPort` → 503 without a browser; the desktop app prints with Electron, see Versions
and icons › PDFs); `GET …/mail-draft` (F10.6).

**Statements are for the tax authority** (user rule, 06.10.2026: „die Exporte sollten keine Todos
drauf haben“): `simple_*` / `detailed_*` show only declared figures and how they were computed —
never open items, check lights, „zu prüfen“/„nachtragen“ wording or a "to check" fill. A position
or event without a price keeps its quantity, the value stays empty/„–“, and a neutral footnote
(`rules.labels.noPriceNote`, `statusNote()` in `export-texts.ts`) says it is not in the total.
`describeItem()` (it may instruct) is for the internal report and the mail only. Everything to
check goes into the **internal report** (F10.2a, kinds `internal_report_pdf|xlsx`, migration
`20261008090000_internal_report_export` widens the kind CHECK): `internal-report.ts` builds one
model (lights, open items with done/note, unpriced positions/income/events, Earn-gap warnings,
F5.8 hints from the project files), rendered by `excel/internal-workbook.ts` and
`pdf/internal-report-html.ts`. The mail draft never lists it as an attachment. The exports spec
scans every cell/HTML of the statements for forbidden words. Web (Exporte tab): statements and
the internal report in separate cards, the list grouped „Auszüge für die Steuerbehörde“ /
„Intern“; `ProjectWorkspaceService.requestExport()` asks (`pendingExport` → dialog „Es gibt noch
N offene Punkte. Trotzdem erstellen?“ with a way to Prüfungen) while open items are not done.

## Dashboard, carry-over, packages, data export (F4.4, F10.7–F10.9, F11.4–F11.9)

**Dashboard** (`/app/dashboard`, the landing page after login; `GET /api/dashboard?from&to[&project]`,
`GET /api/dashboard/records?…&kpi=`, `POST /api/dashboard/rates/refresh`). The engine's
`dashboard()` (`libs/engine/src/dashboard/`) does all of it, from the same records, corrections and
stored rates as the tax calculation (F11.9) — the API only assembles (`DashboardInputService`)
and caches the answer per user + input hash (in memory, 16 entries; files, mapping versions,
corrections, rates, period, engine version — same hash, no file read). Rules across projects:

1. **One record set**: a stored file used in several projects (same SHA-256 → same record ids)
   is read once, from the entry of the project with the newest tax year; `uniqueRecords` also
   dedupes by id in the engine.
2. **Corrections belong to the year of their project**: a correction counts only when the date it
   concerns (reclassified booking's time, manual booking's time, manual holding's date, override
   date) lies in a year its project _owns_ — `yearOwner`: the project of that tax year, else the
   newest project before it, else the oldest after it. Overrides and ESTV values among the stored
   rates follow the same rule (`dashboardRates`); fetched series of every project count.
3. **Accounts without bookings** (statement-only wallets, manual positions) keep their latest
   statement balance until the next one; accounts with bookings follow the ledger, statements win
   on their own day (as `dailyBalances`).

Daily value = Σ holdings × CHF price of the day (price priority of `unitPriceChf`, a statement's
own price on its day); spam and negative balances are not counted; **missing prices are never 0**
— each day lists them (`missing`), the chart marks those days, the holdings say "kein Kurs".
KPIs: In/Out = `deposit`/`withdrawal` not matched as an internal transfer (`matchTransfers`, fiat
always counts), Ertrag = income valued like F7.2 (net, `incomeLine`), Kosten/Verluste = losses +
non-trade fees, Handelsgebühren = fees of trades (same `group`); each with its record ids → the
shared `lk-records-dialog`. Rates: a **user rate cache** (`user_rate`, never `manual`/`estv`) filled
by "Kurse aktualisieren" — FX first, then one request per asset without a price (the app shows
progress), skipped when project or cache rates cover both ends of the period (±14 d) unless
`force`; 409 when lookups are off (F11.3). Period ≤ 3660 days. The project detail shows a compact
card for its tax year (`project` param: only that project). Charts are hand-rolled SVG in
`shared/charts` (no dependency): decimal strings become numbers **only there**, for coordinates;
tooltip + crosshair (mouse, arrow keys), a visually hidden table, colours from tokens (`--alloc-*`
= a validated categorical palette, light + dark; `--positive`/`--negative`).

**Carry-over** (`carryover/`): `GET|POST /projects/:id/follow-up` (F4.4a) — files preselected when
their period reaches into the new year (linked, same stored file, origin `from_project:`),
corrections offered only when they apply beyond the year (reclassify of a booking whose file
reaches into the new year, manual bookings; never overrides or dated manual holdings), open items
not done (latest snapshot + carried ones), notes; `GET|POST /projects/:id/take-over` (F4.4: files
of other projects, already-linked ones skipped). Every item is recorded in `project_carryover`
("aus Projekt X", `GET …/carryovers`); a carried open item is ticked via `open_item_state` with
the key `carried:<carryover id>`. A closed source project is fine (only read). Writes go through
`ProjectBundleRepositoryPort.write` — ONE interactive transaction (project, mappings, files,
corrections with their history, rates, states, exports, carry-overs); the bundle references its
own items by `key`. The previous year's closing positions reach the new project's checks through
`CalculationInputService.previousYear` (same owner, year − 1, latest snapshot) — unchanged.

**Data export** (F10.7, `GET /projects/:id/data-export?format=csv|xlsx&type=&platform&account&asset&kind&from&to`):
`standardExport` in the engine → the template's columns (re-importable as is; corrections
applied) + `Typ (Original)`, `Korrekturen`, `Kurs CHF verwendet`, `Kursquelle`, `Wert CHF`,
`Quelldatei`, `Zeile`. CSV = one record type with a UTF-8 BOM; XLSX = both sheets, every cell
text. Lost on a round trip: `rawType` (becomes the kind), `valueUsd`/`feeValueUsd`.

**Packages** (`packages/`, fflate): `GET /projects/:id/package` → `<name>-<year>.lkproj.zip`;
`POST /projects/import-package` (raw body) → a new project; `GET /account/package`,
`POST /account/import-package` (Profil). `manifest.json` = format + version, app version
(`APP_VERSION`), created, project facts, files (SHA-256, size, role original/derived, analysis,
mapping key), mappings, exports, counts, and `entries` = **every** other ZIP entry with SHA-256 +
size. Import verifies before writing: ZIP directory limits (package ≤ 200 MB, inflated ≤ 1 GB,
entry ≤ 200 MB, ≤ 20 000 entries; nginx in front allows 50 MB), safe paths only (no `..`,
absolute, backslash, drive — zip-slip), entries exactly as listed with matching hashes (else 422
"tampered"), every JSON by zod, mappings by `validateMappingSpec`, corrections by the engine
schema, files re-read (kind from bytes, analysis again). Mappings reused when fingerprint AND
spec (canonical JSON) are equal, else stored as `copied`; stored files deduplicated by SHA-256 per
owner; the same name + year gets ` (2)`; an imported closed project comes back as `reviewed`
(snapshots do not travel — recalculate). The account package nests the project packages (stored)
plus all mappings, `settings.json` **without any key** and `profile.json`; its import writes the
mappings, then each project in its own transaction, and settings only when the account has none.
Built in memory (SQLite BLOBs are in memory anyway) — the limits keep that bounded.

## Database (SQLite)

One file, no database server. Prisma talks to it through `@prisma/adapter-better-sqlite3`, a
native module opened in-process — the same storage the desktop app will use.

- **Where the file is**: `DATABASE_URL=file:<path>`. A relative path resolves against the
  **working directory** (`src/persistence/prisma/sqlite-url.ts`, used by `PrismaService` and
  `prisma.config.ts` alike). Every `pnpm`/`nx db:*` command runs from the repo root, so dev is
  `<repo>/.data/lazykoins.db`; the container uses `file:/data/lazykoins.db` on a volume.
- **One writer**: a single API instance per database file. `PrismaService` enables WAL and a 5 s
  `busy_timeout`.
- **CHECK constraints** are written _inside_ each `CREATE TABLE` of the init migration (status
  values, country, canton = 2 upper-case letters, tax year range, non-blank name). **Trap:** for
  most column changes Prisma's SQLite migrations _redefine_ the table, and the new
  `CREATE TABLE` lacks the hand-written CHECKs — copy them into the generated SQL before
  committing. `persistence.integration.spec.ts` tests them and fails when they disappear. After a
  schema change, `prisma migrate diff --from-migrations prisma/migrations --to-schema
prisma/schema.prisma` must still report **no difference**.
- DateTime values are stored as ISO text with `+00:00`; anything writing rows outside Prisma
  (`scripts/dev/seed.mjs`) must use exactly that format.
- Ids are `uuid(7)` generated client-side; raw inserts (seed) supply their own.
- `user.identity_uid` is the Firebase uid, `dev:<email>` or `local:owner`. Deleting a user
  cascades to their projects, stored files and mappings (F2.2).
- **Files** (migration `20261006120000_files_and_mappings`): `stored_file` (BLOB, unique
  `(owner_id, sha256)`, CHECKs: hex SHA-256, kind, `size = length(bytes)`), `import_mapping`
  (spec as JSON text, `json_valid` CHECK) and `project_file` (status/origin/count/period CHECKs,
  `mapped` needs a `mapping_id`). A stored file is deleted with its **last** `project_file` — in the
  same transaction, also when a project is deleted (`ProjectPrismaRepository.delete`).
- **AI** (migration `20261007090000_ai_settings`): `ai_settings` (PK `user_id`, cascade with the
  user, CHECKs: provider, key sealed `enc:v1:%`, hint ≤ 8 chars). The same migration **redefines
  `project_file`** only to widen its origin CHECK to `derived_from:_%` — all other CHECKs copied.
- **Calculation** (migration `20261007120000_calculation_rates_exports`, sorts after the AI one):
  `user_settings` (PK `user_id`; keys sealed `enc:v1:%`, canton/format/JSON CHECKs),
  `project_rate` (unique `(project, kind, asset, currency, date, source)`; kind/currency/source/
  date/decimal CHECKs), `calculation_snapshot` (result + records as JSON, 64-char input hash; the
  latest 3 per project are kept), `correction` (type CHECK, `undone_at` = undo), `open_item_state`
  (PK `(project_id, item_key)`) and `project_export` (BLOB, kind + size CHECKs). All cascade with
  the project; `calculation.persistence.integration.spec.ts` tests the CHECKs.
- **Dashboard / carry-over** (migration `20261008100000_dashboard_carryover`): `user_rate` (unique
  `(user, kind, asset, currency, date, source)`; source only `binance|coingecko|ecb`, decimal/date
  CHECKs; cascade with the user) and `project_carryover` (kind CHECK, `json_valid(data)`; cascade
  with the project; `source_project_id` is no FK — the source may be deleted later, its name stays).
  `carryover.persistence.integration.spec.ts` tests the transaction and the CHECKs.
- `pnpm install` runs `prisma generate`; `prisma.config.ts` falls back to an unconnectable
  placeholder URL so that works without an `.env`.

## Auth

**Firebase Authentication is the identity provider for the web app; the API is only a resource
server.** Three modes, `AUTH_MODE` in the API (validated in `config/env.ts`):

- **`firebase`** (default, production web): the app signs in with the Firebase JS SDK —
  e-mail/password (register, sign in, password reset by Firebase) and Google (popup) — and sends
  the **Firebase ID token** as the bearer. `FirebaseIdentityTokenVerifier` checks it against
  `FIREBASE_PROJECT_ID`. The SDK is `import()`ed on first use, so dev mode never loads it.
- **`dev`** (API) + **`authMode: 'dev'`** (app, `env.js`): the token `dev:<email>` signs in as
  that address, no Firebase project needed. `validateEnv` refuses it unless
  `NODE_ENV=development|test`. In Scalar, paste `dev:anna@lazykoins.dev`.
- **`local`** (the desktop app, F1.2): **no token at all** — every request acts as one
  fixed user (`LOCAL_USER_EMAIL`, uid `local:owner`) via `LocalIdentityVerifier.ambient()`.
  Allowed in any `NODE_ENV`, but only with the explicit second switch **`LOCAL_MODE=true`**
  (and `LOCAL_MODE=true` is refused with any other mode), and `bootstrap.ts` then listens on
  **127.0.0.1 only**. Never set it on a server. The desktop additionally passes a per-launch
  `accessToken`: every request without `x-lazykoins-desktop: <token>` gets a 403 (loopback is
  reachable by every program and web page on the machine). The app's `authMode: 'local'`
  (`LocalAuthStrategy`) has no login page, takes the address from `/api/me`, and hides sign-out
  and the address (`AuthService.hasAccount`, F11.0a).

`AccessTokenGuard` (global) verifies the token through `IdentityTokenVerifierPort` (or takes the
ambient identity when none is sent); `PrincipalService` creates the user row on first sight.
`@Public()` opts a route out (health). No roles: "you may act on what you own", checked in
handlers.

## Runtime configuration (app)

`apps/web/public/env.js` → `window.__LK_ENV__`, read by `core/config/runtime-env.ts`. The web
container's `entrypoint.sh` rewrites it at start from `LK_*` variables, so one image serves every
environment.

| Key          | Dev (`public/env.js`)                                                  | Container (`entrypoint.sh`)              |
| ------------ | ---------------------------------------------------------------------- | ---------------------------------------- |
| `apiBaseUrl` | empty — dev server proxies                                             | `LK_API_BASE_URL`, empty = nginx proxies |
| `authMode`   | `dev`                                                                  | `LK_AUTH_MODE`, default `firebase`       |
| (desktop)    | generated by the app:// handler: `apiBaseUrl: ''`, `authMode: 'local'` |                                          |
| `firebase.*` | empty                                                                  | `LK_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, … |

Only `/api` URLs get the bearer token (`isApiRequest`), never the i18n files or another host.
There is no `GET /api/config` (surf-lend's console settings); env.js is the only source.

## Desktop (`apps/desktop`, F1.2, F3.1, F3.4)

Electron **42** (pinned exactly — see the native-module gotcha) + electron-builder. One window,
single-instance lock, `contextIsolation`, `sandbox`, no `nodeIntegration`, a strict CSP (own files
only; `style-src 'unsafe-inline'` for Angular), every permission request refused, no navigation
away from the app, `http(s)` links open in the system browser, no `<webview>`.

- **API in-process**: `api-host.ts` applies the migrations, sets the environment
  (`lib/api-env.ts`: `AUTH_MODE=local`, `LOCAL_MODE=true`, `NODE_ENV=production`,
  `DATABASE_URL=file:<dataDir>/lazykoins.db`, `SETTINGS_ENCRYPTION_KEY` from
  `<dataDir>/lazykoins.key` (created once, travels with the database), `LK_IGNORE_ENV_FILE=true`)
  and only **then** `require`s `api/main.js` (`apps/api/src/desktop.ts`, built by
  `nx run api:build-desktop`) and calls `bootstrap({ port: 0, shutdownHooks: false, accessToken })`
  — 127.0.0.1, a port the OS picks. Quitting closes the Nest app (Prisma disconnects, WAL is
  checkpointed) and removes the lock.
- **Window ↔ API: the `app://lazykoins` protocol** (`protocol.ts`, pure routing in
  `lib/web-protocol.ts`) serves the Angular build (`nx run web:build:desktop`, critical-CSS inlining
  off because of the CSP), a generated `env.js` (`authMode: 'local'`) and **proxies `/api/…`** to
  the API with the access token (Node `fetch`, never a system proxy). Same origin, no CORS, and a
  **stable origin** across starts although the port changes — localStorage survives.
- **Migrations without the Prisma CLI** (`lib/migrations.ts`): the folders of
  `apps/api/prisma/migrations` (shipped as `migrations/`) are applied in name order, each in a
  transaction with `foreign_keys` off around it, and recorded in a **`_prisma_migrations`-compatible
  table** (checksum = SHA-256 of the file) — `prisma migrate status` against a desktop database says
  "up to date". Chosen over shipping the CLI + schema-engine binary per OS/arch. A failing
  migration rolls back and the app refuses to start (dialog), data untouched.
- **Data folder (F3.1)**: default `<userData>/data` (dev runs use `<appData>/lazy-koins-dev`);
  chosen folder in `<userData>/desktop-config.json`; `LK_DATA_DIR` overrides both (tests).
  **Einstellungen → Speicherort** (`/app/settings/storage`, route only exists when
  `window.lazykoinsDesktop` does) → IPC → native folder picker → "open the data already there" or
  "copy current data (better-sqlite3 backup API) / start empty" → **relaunch** (the API's
  ConfigModule reads the environment once per process). Sync folders (OneDrive, Google Drive,
  Proton Drive, Dropbox, iCloud — `lib/sync-folder.ts`, by path) get the F3.4 warning.
- **Lock file (F3.4)**: `<dataDir>/lazykoins.lock` (host, pid, heartbeat every minute). A fresh
  marker from another host (heartbeat < 5 min) or a live other pid on this host → warning dialog
  "wird auf einem anderen Gerät bearbeitet" (Beenden / Trotzdem öffnen). Conflict copies the sync
  client leaves (`lazykoins-PC.db`, `lazykoins (1).db`, …) are reported at start and on the page.
- **Build**: `scripts/stage.mjs` assembles `dist/apps/desktop-app` (esbuild main + preload, API
  bundle, web build, migrations, a `package.json` with the API's runtime dependencies minus
  `prisma`/`dotenv`), installs them with `pnpm install --prod` as its **own** workspace
  (pnpm's normal isolated layout, `packageImportMethod: copy`) and puts the **prebuilt**
  better-sqlite3 for Electron in (`scripts/native-deps.cjs`, prebuild-install). electron-builder
  (`electron-builder.config.cjs`, appId `ch.lazykoins.desktop`) packages it into `dist/desktop`:
  NSIS x64 `lazy-koins-Setup-<v>.exe`, dmg arm64 + x64. `npmRebuild: false`; its `afterPack` hook
  swaps the binary for each target arch inside `app.asar.unpacked` (`asarUnpack` for `.node`).
  Version = `LK_VERSION` (CI: the tag), see Versions and icons. Icons: `build/icon.png` +
  `icon.ico`, generated.
- **Errors**: `src/main/entry.ts` installs the last-resort handler before loading anything — a
  German dialog instead of Electron's raw stack, then exit; start failures likewise. Both are
  logged with the stack to `<userData>/logs/main.log`. `LK_NO_DIALOGS=1` (automated runs) only
  logs. Hilfe → Über lazy-koins shows the full version.
- **Unsigned, no auto-update** (open decision). Signing later via `CSC_LINK`/`CSC_KEY_PASSWORD`
  and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` as GitHub secrets (names in
  `deploy/README.md`); without `CSC_LINK` the mac identity is forced off.
- Verify by hand: `pnpm build:desktop`, run `dist/desktop/win-unpacked/lazy-koins.exe` (or with
  `LK_DATA_DIR=<tmp>`); `--remote-debugging-port=9333` allows driving the window over CDP.

## Versions and icons

**One version source: `scripts/build/version.mjs`** (`pnpm version:info`; tests in
`version.spec.mjs`, Vitest project `scripts`). Format **`X.Y.Z+<shortsha>`**: `X.Y.Z` = `LK_VERSION`
(CI: the release tag) or the nearest `vX.Y.Z` tag, else `0.0.0-dev`; the commit = `LK_COMMIT`
(Docker builds have no .git) or `GITHUB_SHA` or git; a local build with uncommitted changes gets
`.dirty`. Computed **at build time only**:

- **API**: webpack `DefinePlugin` `__LK_BUILD__` (`apps/api/webpack.build-info.js`, both bundles) →
  `src/app/build-info.ts` → `GET /api/health` (`version`) and public **`GET /api/version`**
  (`{ version, commit, full, builtAt }`). Unbundled (Vitest): `0.0.0-dev+unknown`.
- **Web**: reads `/api/version` (`core/version/app-version.service.ts`) and shows "lazy-koins
  vX.Y.Z (abc1234)" in the shell's footer — web and API always come from the same commit.
- **Images**: `_images.yml` passes `LK_VERSION`/`LK_COMMIT` build args (nearest tag at build time —
  test images are promoted unchanged to production, so the commit is what identifies them) and
  sets `org.opencontainers.image.version` (full) + `.revision`.
- **Desktop**: `stage.mjs` writes the plain semver into package.json (installers need it; file
  names `lazy-koins-Setup-<v>.exe`, `lazy-koins-<v>-<arch>.dmg`) and the full build into
  `lkBuild`; shown in Hilfe → Über lazy-koins (macOS: About panel) and Einstellungen → Speicherort.
- **Exports**: `ExportData.appVersion` (= `BUILD_INFO.full`) — "Erstellt mit lazy-koins …" on the
  Methodik sheet/section and in the PDF footer.
- **PDFs** (`integrations/pdf/`): one set of print options (`print-options.ts`: A4, margins,
  "Seite x / y" footer) for two renderers, chosen by `selectPdfRenderer` in `IntegrationsModule`:
  **desktop** = `HostPdfRenderer` around the printer the host passes to `bootstrap({ pdfPrinter })`
  — `apps/desktop/src/main/pdf-printer.ts`, Electron's `webContents.printToPDF` in a hidden,
  sandboxed window with JavaScript off and its own in-memory session that may load nothing but
  the temporary HTML file (offline, one print at a time, 60 s timeout); **server/container** =
  `PlaywrightPdfRenderer` (`PDF_CHROMIUM_PATH` / Playwright's download). The registration is a
  module-level hook set before `NestFactory.create` (the API bundle must not import electron).

**Icons**: one source, `assets/brand/icon.svg`. `pnpm icons` (`scripts/build/icons.cjs`, rendered
by Electron's Chromium — no image library) writes `apps/desktop/build/icon.png` (1024) +
`icon.ico` (16–256) and `apps/web/public/favicon.svg|.ico` + `apple-touch-icon.png` (180); outputs
are committed. The header shows `favicon.svg` at 24 px next to the word mark.

## Feature structure (app)

Same as surf-lend: one folder per lazily loaded feature, `<feature>.routes.ts` default-exporting
its routes, `pages/<page>/{<page>.ts,.html,.service.ts,.spec.ts}`, and `components/<c>/index.ts`
only for components shared by more than one page (`project-status-badge`). **One page service
per page** — business logic and API access live there, not in the component. Detail-page services
are provided by the component (`providers: [...]`), list/form services are root.

- Route params bind to `input()`s (`withComponentInputBinding`). **Absent params bind as
  `undefined`** and override an input's default — give such inputs no default
  (`login-page.spec.ts` guards it).
- Mutations go through `defineAction` + `ActionRunner` in the page service; messages are i18n keys.
- Dialogs for decisions (reopen a closed project, delete), pages for forms.
- **Dialog layout** (user rule, 07.10.2026): three fixed regions — `<hlm-dialog-header>` at the top,
  `<div class="lk-dialog-body">` in the middle (the ONLY part that scrolls), `<hlm-dialog-footer>`
  with every action button across the full width at the bottom. All three are **direct children**
  of `<hlm-dialog-content>`; a footer inside an `@if` is fine as long as it stays a direct child.
  Styled globally in `styles.css`. The same goes for any other overlay with actions.
- Desktop first: the shell is a header with the navigation (`core/layout/app-shell`), no tab bar.

## UI, styling, i18n

- spartan components are generated, never hand-written: `npx nx g @spartan-ng/cli:ui
--name=<c> --no-interactive` (skill `add-ui-component`). `libs/ui/**` is vendored — don't edit
  or format it. `ls libs/ui/` for what exists (badge, button, card, dialog, dropdown-menu,
  input, label, separator, skeleton, sonner, table, textarea, tooltip, utils). Selects are
  native `<select hlmInput>`, as in surf-lend.
- **Tables** (user rule, 07.10.2026: "cutte zu lange Texte, fixiere den Interaktionsbereich",
  Pagination überall, wo es gross werden kann). Every `hlmTable` follows one pattern — copy
  `project-files.html` or `project-rates.html`:
  - `<table hlmTable class="table-fixed">` with a `<colgroup>`: **one** flexible `<col />` (the
    main column), compact fixed widths for the rest (`w-14` … `w-48`); columns that matter less
    get `hidden md:table-column` / `lg:` / `xl:` on the `col` **and** `hidden md:table-cell` on
    `th`/`td`. Secondary info is a second muted line (`text-muted-foreground text-xs`) under the
    main cell. **No horizontal scrolling at ≥ 1024 px** (checked at 1024 and 1280).
  - Long text: the cell gets `max-w-0` (a fixed-layout cell may then shrink below its text),
    the text sits in `<span [lkTruncate]="text">{{ text }}</span>`
    (`shared/components/truncate`): block, one line, "…", and the full text as a tooltip
    **only when it is actually cut** (measured on hover). For a computed text use `@let`.
    Badges/fixed bits next to a cut text: `flex min-w-0 items-center gap-2` + `shrink-0`.
  - Actions: the last column (`<col class="w-14" />`) is `lk-sticky-actions text-right` on
    `th` (with `<span class="sr-only">{{ 'common.actions' | translate }}</span>`) and `td`, and
    holds **`<lk-row-actions [actions]="…" (selected)="…" />`** (`shared/components/row-actions`):
    a list of `{ id, labelKey, icon (the lucide SVG import, no provideIcons), danger?,
disabled?, hidden? }`. Exactly one visible action → a plain icon button with tooltip; more
    → one vertical-dots button (`lucideEllipsisVertical`, aria-label "Aktionen") opening the
    spartan dropdown menu (icon + label, destructive ones last after a separator, in the danger
    colour; CDK menu = arrow keys, Escape, focus return). It stops click propagation, so it works
    in clickable rows. Build the arrays once (a `computed`, or a `Map` per row id) — not a new
    array per change detection. `hidden: closed()` for changes on a closed project (F4.5).
  - Pagination: `pager = paginate(rows, { storageKey, resetOn })` (`shared/components/paginator`)
    over the already filtered/sorted signal, render `pager.visible()` and
    `<lk-paginator [pager]="pager" />` under the table. Default 10 rows, 10 / 25 / 50 / 100
    selectable and remembered per `storageKey` (localStorage, try/catch), „Zeile 1–10 von 57",
    first/previous/next/last; hidden while everything fits on 10 rows; back to page 1 when
    `resetOn()` (search, filter, sort, opened group) changes; the page stays valid when rows
    disappear; `pager.reveal(row => …)` shows the page holding a row (`#file-<id>`). Every table
    that can grow is paged (projects, files per platform, mappings, usage, rates, positions,
    income lines, Earn gaps, one-off events, records drill-down, open items, corrections,
    exports, mapping preview, PDF review); small fixed summaries (platform/category totals) are
    not. No endpoint pages server-side yet — the drill-down is capped by the API.
  - The raw-data preview of a file keeps its own horizontal scroll inside the dialog (raw rows
    are wide) but cuts each cell at `max-w-64` with `lkTruncate`.
- Colours live **only** in `apps/web/src/styles.css` (light + `:root.dark`). Templates use
  semantic classes; `no-hardcoded-design-values` rejects hex, arbitrary px and inline styles.
- The look: calm and neutral for reading figures — cool slate greys, an ink-blue primary, Inter,
  radius 0.5rem; component classes `lk-brand`, `lk-nav-link`, `lk-panel`, `lk-facts`.
- Every visible string is a key in `public/i18n/de-CH.json` (German/Swiss, du-form);
  `no-hardcoded-text` rejects literal text in templates and `core/i18n/i18n-keys.spec.ts` fails
  when a referenced key is missing. Keys built at runtime (`projects.status.<status>`) are listed
  in that spec.
- Selector prefix `lk` for app code, `hlm` in `libs/ui`.

## Testing

`pnpm test` runs every project's Vitest config through the root `vitest.config.ts` — **not
through Nx**: Vitest fails inside Nx's run-commands spawn on this Nx/Vitest combination (found in
etx), so no `project.json` has a `test` target, deliberately.

| Project              | Wiring                                                                        |
| -------------------- | ----------------------------------------------------------------------------- |
| `apps/api`           | `vitest.config.ts` + `unplugin-swc` (decorator metadata for Nest DI)          |
| `apps/web`           | `vitest.config.ts` + `@analogjs/vite-plugin-angular`, jsdom, TZ pinned to UTC |
| `libs/engine`        | `vitest.config.ts`, plain Node                                                |
| `tools/eslint-rules` | `vitest.config.ts`                                                            |
| `apps/desktop`       | `vitest.config.ts`, plain Node — only `src/main/lib` (no Electron import)     |
| `scripts`            | `vitest.config.mjs` — `build/*.spec.mjs` (version script)                     |

- **Unit**: pure domain functions, handlers against **port doubles**, the module graph
  (`app.module.spec.ts` compiles every provider), page services with `HttpTestingController`,
  the engine (money, text decoding, standard format, mapping specs applied to the synthetic
  Kraken/Binance/Bitfinex/Revolut fixtures, coverage). The AI plugin is tested with a fake
  `fetch` (adapters) and a fake `AiCompletionPort` (handlers), PDFs are generated in the test with
  `pdf-lib` — never a real provider call. `files.handlers.spec.ts` runs the real
  engine + exceljs against in-memory ports. The calculation slices share
  `calculation/testing/calculation-fixture.ts` (synthetic standard-format files + every handler
  over port doubles); rate sources are faked (`rates/testing/`), adapters get a fake `fetch`; the
  exports spec opens the generated workbook with ExcelJS and checks the formulas. The real
  Chromium print (`playwright-pdf.renderer.spec.ts`) skips itself when no browser is installed.
- **Integration** (`*.integration.spec.ts`, excluded from `pnpm test`): the Prisma adapters
  against a real SQLite file with the real migrations — owner listing, empty updates, cascade,
  CHECK constraints. `scripts/dev/with-test-db.mjs` points them at `tmp/lazykoins-test.db`
  (never your dev database) unless `DATABASE_URL` is already set.
- Dashboard / carry-over / packages: `bundleSetup()` (`carryover/testing/bundle-fixture.ts`) adds
  the bundle, carry-over, export and user-rate doubles to the calculation fixture; package specs
  build tampered / zip-slip ZIPs with fflate; the data-export spec re-uploads its own CSV.
- **Golden** (`libs/engine/src/golden/golden.spec.ts`, A1): part of `pnpm test`, `describe.skipIf`
  `private/golden.json` does not exist (CI, other machines). Today it only checks existence.
- `libs/engine` has a `typecheck` target (Vitest's esbuild does not type-check); `pnpm check`
  runs it with the builds.
- Every bug fix gets a regression test.

## CI

`.github/workflows/ci.yml` on push to `main` and on pull requests: `check` (= `pnpm ci:verify`)
and `integration` (`pnpm ci:integration`, no database service needed). **The gate lives in
`package.json`** — add checks to `ci:verify`, never to the YAML alone.

Release and deploy (ported from surf-lend, details in `deploy/README.md`): `deploy-test.yml`
(after CI on `main`: `_images.yml` builds `ghcr.io/<owner>/lazykoins-api|web:sha-<commit>`, then
`_deploy.yml` tags `:test` and redeploys Coolify), `deploy-production.yml` (release `vX.Y.Z`
published, or "Run workflow" with bump/version → creates the release, appends the desktop install
notes → `deploy` re-tags `:production` after the `production` environment's approval, and
**`desktop`** = `_desktop.yml` in parallel, not waiting for the approval). `_desktop.yml` also has
`workflow_dispatch` (input `tag`) to rebuild an existing release's installers; matrix
`windows-latest` + `macos-latest`, `pnpm build:desktop`, `gh release upload --clobber`. Validated
with actionlint (+ shellcheck). `apps/desktop` has no `build` target on purpose (`pnpm check` runs
`run-many -t build`); its `typecheck` is in the gate.

`.eslint-budget.json` records warning ceilings (all 0); they may only go down. `libs/ui` is not in
the budget (vendored); its one noisy rule is switched off in `libs/ui/utils/eslint.config.mjs`.

## Deployment

- `apps/api/Dockerfile` — webpack bundle + pruned production install
  (`scripts/build/complete-api-package-json.mjs` adds what webpack cannot see); the container
  runs `prisma migrate deploy && node main.js`. `GET /api/health` is public. **Mount a volume at
  `/data`** (the database file) and run exactly one replica.
- `apps/web/Dockerfile` — the web build behind nginx, `/api` proxied to `LK_API_UPSTREAM`
  (uploads up to 50 MB), `env.js` written from `LK_*` at start.
- **Coolify** (`deploy/`): one Docker Compose resource per environment from
  `deploy/coolify/lazykoins.yml` (`api` + `web`, `IMAGE_TAG` = `test` | `production`,
  `pull_policy: always`, volume `lazykoins-data` at `/data`, never scale `api`), first-time setup
  in `deploy/coolify/SETUP.md`, `deploy.sh` (Coolify API redeploy, waits) and `smoke-test.sh`
  (`/api/health`, `/`, `/env.js`). GitHub environments `test` / `production` hold `COOLIFY_URL`,
  `COOLIFY_RESOURCE_UUIDS`, `LAZYKOINS_SITE_URL` (variables) and `COOLIFY_TOKEN` (secret); without
  the token the deploy step only reports the images. Production never rebuilds.

## Rules that come from the requirements

- **Numbers.** Crypto quantities have up to 18 decimals; JS `number` loses them. Every quantity,
  rate and CHF amount is a `Decimal` in code (`libs/engine/src/money`: `parseDecimal` from the
  original **string** — there is no `fromNumber`) and a **decimal string (TEXT)** in the database
  and the API. Never `parseFloat`, never `x * rate` on numbers. Round only when presenting or
  exporting, always with an explicit mode (`roundTo`, `formatFixed`, `formatChf`) — A1 compares
  to ±0.05 CHF; the Kraken balance must match **exactly**.
- **Original files are immutable** (F5.3). Store them content-addressed by **SHA-256**: that is
  also duplicate detection (F5.4), sharing a file between projects without a copy (F4.4) and the
  reference count that decides when it is really deleted (F5.7).
- **Traceability** (F7.5): every `Booking` carries `sourceFileId` + `row` (or page for PDFs); every
  result figure keeps the ids of the bookings it was computed from. Never aggregate them away.
- **Determinism** (F7.6): the engine is a pure function of (bookings, corrections, rate table,
  country rules). No `Date.now()`, no randomness, no network inside it; rates are fetched _before_
  and stored per project with their source (F7.4). Sort explicitly — never rely on input order.
  `libs/engine/eslint.config.mjs` enforces it: no framework, Prisma, `node:*`/fs/network imports,
  no `fetch`, `process`, `Date.now()`, `new Date()`, `Math.random()`, `parseFloat`.
- **Corrections are data, not edits** (F9.4): they are applied on top of the imported bookings,
  each with reason, date, before/after, and can be undone. Imported bookings are never changed.
- **Country rules behind an interface** (F7.7); only `ch` exists. Labels and form references in
  exports come from the rules (F10.3).
- **Closed projects are read-only** (F4.5): the API answers every change but reopening (a status
  change alone) with 409, deleting included; the app confirms reopening in a dialog.
- **Seed phrases and private keys** (F6.2) are detected and refused before anything is stored or
  logged — not even in an error message.
- **No tax advice**: every export carries the "keine Steuerberatung" note (F10.4).
- **Statements carry no to-dos** (F10.1/F10.2): no open items, checks or instructions — those
  belong in the internal report (F10.2a) and the Treuhänder mail.
- **Network is optional** (F11.3): with rate lookups off, everything still works from stored or
  manually entered rates.

## Private data

`private/` holds the user's **real** exports and `private/golden.json` (the expected values for
A1). It is git-ignored and must stay that way.

- **Claude reads structure only** (decided 06.10.2026): file names, column headers, row counts and
  periods — through **`pnpm private:inspect`** (`scripts/private-inspect.mjs`: relative path,
  size, kind; CSV delimiter + header + data-row count; XLSX sheet names + header row + row count;
  JSON top-level keys only), never the rows. Don't open files under `private/` with any tool (a
  `Read(./private/**)` deny in `.claude/settings.json` is still to be added by the user). Results
  against real data come from the golden test, which reports "matches" or "off by X CHF in
  <position>" — not the underlying rows.
- Never commit it, and never copy values, addresses, amounts or file excerpts from it into
  fixtures, tests, logs, commit messages, PRs or issues. Fixtures are synthetic.
- The golden test reads `private/` at run time and **skips** when it is absent (CI, other
  machines).
- Tooling keeps out of it: `.gitignore`, `.prettierignore`, `.nxignore`, `.dockerignore`, the
  root `eslint.config.mjs` ignores, the root `vitest.config.ts` project globs and
  `tsconfig.base.json` all exclude `private/`.
- Two guards against committing: `.gitignore`, and `.githooks/pre-commit`, which refuses any
  staged path under `private/` (also after `git add -f`). `pnpm install` sets
  `git config core.hooksPath .githooks` (`scripts/dev/install-hooks.mjs`); in a clone without
  `pnpm install`, set it by hand. Never `--no-verify`.

## Decisions (06.10.2026)

- **Desktop = Electron** (`apps/desktop`): the main process starts the Nest API in-process on
  `127.0.0.1` with its own SQLite file in the chosen storage folder (F3.1) and loads the Angular
  build. No login: the API runs in `AUTH_MODE=local` (already built, see Auth). Same engine, same
  results as the web.
- **Desktop releases in CI** (F1.4): every release vX.Y.Z builds the Electron app with
  **electron-builder** on a matrix (`windows-latest` → NSIS `.exe`, `macos-latest` → `.dmg`
  arm64 + x64) and uploads the files to that GitHub release. It must be a job **inside** the
  production release workflow (a reusable `_desktop.yml` called from `deploy-production.yml`),
  because a release created with `GITHUB_TOKEN` (the "Run workflow" path, as in surf-lend) does
  not trigger other workflows' `release` events. App version = tag. `better-sqlite3` must be
  rebuilt for Electron's ABI (`electron-builder install-app-deps`). Unsigned until signing is
  decided; the release notes explain SmartScreen / Gatekeeper.
- **Web auth = Firebase Authentication**, as in surf-lend: the API is a resource server that
  verifies Firebase ID tokens (port + adapter in `integrations/`); e-mail/password and Google,
  password reset by Firebase (F2.1). A dev mode `dev:<email>` like surf-lend's `AUTH_MODE=dev`.
  Every row is scoped to its owner; someone else's project reads as 404.
- **Hosting = Coolify** on the Hostinger VPS (next to surf-lend / hello-eme), same pipeline
  (ghcr images, test → production). **Original files are BLOBs in SQLite**, keyed by SHA-256 —
  same storage in web and desktop, one file to back up. One API replica per database file.
- **Rates = ESTV + CoinGecko**: Steuerwert at 31.12. from the ESTV Kursliste (ICTax) when the
  asset is listed; otherwise, and for income on the day it arrives, CoinGecko's daily CHF price
  (user's API key, F6.7). Every rate is stored per project with its source and can be overridden
  (F7.4, F9.1). Fetching happens before the calculation, never inside it.
- **Wallet networks, automatic** (F6.3): Bitcoin (mempool.space / Esplora, addresses + xpub/zpub),
  EVM chains (Etherscan API V2, one key for all chains), Solana (indexer such as Helius), and
  Cardano / Polkadot / Cosmos (Koios, Subscan, Mintscan). One `ChainDataPort` adapter per network
  in `integrations/`; everything else is manual with a receipt (F6.5).
- **Exports = ExcelJS + Chromium PDF**: Excel with real formulas, named cells and styles (ExcelJS,
  already a dependency — `private:inspect` reads XLSX with it); PDF from HTML/CSS templates printed
  by Chromium (Electron's `printToPDF` on the desktop, Playwright in the API container).

## Secrets

- Never commit `.env` files, keys, service-account JSON or passwords (`.gitignore` covers the usual
  names; only `.env.example` with placeholders is committed — `apps/api/.env.example`). CI
  credentials live in GitHub → Settings → Secrets and variables → Actions; runtime secrets in
  Coolify. The Firebase **web** config in `env.js` is public by design, not a secret.
- If a secret was ever committed: **revoke and rotate it first** — deleting the file does not
  remove it from history. Scrubbing history (`git filter-repo`) comes after, if at all.
- Security reports go through GitHub private vulnerability reporting ([SECURITY.md](SECURITY.md));
  `.github/CODEOWNERS` requires the owner's review.

- **AI plugin = provider-agnostic port, no SDK** (07.10.2026): OpenAI-compatible + Anthropic
  adapters over `fetch`; the AI writes **mappings, not bookings**; PDFs are a one-off conversion to
  a derived standard CSV. Settings in their own `ai_settings` table, not a generic settings table.

## Open decisions — ask, don't decide

- **OneDrive / Google Drive** connection for the web app (F3.2): API approach and folder sync.
- **Desktop packaging**: code signing / notarisation (Apple developer account, Windows
  certificate) and auto-update (would need a `publish` provider → `latest*.yml` on the release).
- **Frontend API types**: hand-mirrored in `core/api/api.types.ts` vs. generated from
  `/api/openapi.json` (same open point as surf-lend).

## Conventions carried over from surf-lend

- Persistence: Controller → Service façade → Command/QueryBus → Handler → Repository **Port**
  (abstract class) → Prisma adapter. Nothing outside `src/persistence/` imports Prisma.
- App features: `features/<feature>/<feature>.routes.ts` + `pages/<page>/{.ts,.html,.service.ts,.spec.ts}`,
  one page service per page; selector prefix **`lk`**.
- Every visible string is an i18n key; colours only in `styles.css` (light + dark).
- **The gate lives in `package.json`** (`pnpm check` = lint + budget + format + test + build +
  typecheck); CI only calls it. Every bug fix gets a regression test.
- The Nx daemon is disabled (`useDaemonProcess: false`) — its cold start costs minutes on Windows.

## Environment gotchas

- **The engine is consumed by path alias**: webpack resolves `@lazykoins/engine` through
  tsconfig paths; the API's Vitest configs alias it explicitly (`apps/api/vitest*.config.ts`).
- **Uploads are raw bodies**: `RawBodyMiddleware` is bound to exactly `POST
projects/:projectId/files` (sub-paths keep the JSON parser) and turns body-parser's 413 into a
  Nest exception. The web sends `application/octet-stream` with `?name=`.
- Angular's fetch backend (`withFetch()`) emits **no upload progress** events; the files area
  shows per-file state and the batch's progress instead.
- `hlmBtn` styles `button`/`a` only — a `<label hlmBtn>` renders unstyled; use a button that
  clicks a hidden `<input type="file">`.
- `HttpTestingController.match()` **removes** what it matches; jsdom's `File` has no `text()`.
- DatePipe formats like `'dd.MM.yyyy'` look like i18n keys; `i18n-keys.spec.ts` skips them.
- Keep `\uFEFF` and other invisible characters as escapes in source (`no-irregular-whitespace`).

- `better-sqlite3` is a native module: it is in `allowBuilds` (pnpm-workspace.yaml), and the API
  image installs a C++ toolchain in the build stage and `libstdc++` at runtime for it.
- `apps/api/.env` holds secrets — never commit it, and don't print it.
- Nx needs the daemon off in containers too (`NX_DAEMON=false`, already set in CI and Dockerfiles).
- `pkill -f "<pattern>"` inside a compound shell command matches that shell itself and kills it;
  stop dev servers by PID (`taskkill /PID <pid> /T /F` on Windows).
- Port 4200 may be taken by another local app; `pnpm nx serve web --port=4310` (any free port)
  works the same — the proxy to :3333 is unchanged.
- Angular needs `apps/web/.postcssrc.json` for Tailwind v4; without it `@utility` rules pass
  through unprocessed and nothing is styled.
- Comment keys in `project.json` are named `lk-note-*`, not `"// …"` as in surf-lend: the Angular
  builder warns about every project.json key that does not match `^[a-z]{1,3}-`.
- On Windows, git may check files out with CRLF (`core.autocrlf`); `.gitattributes` normalises to
  LF in the index and Prettier (`endOfLine: auto`) accepts both. Scripts that edit files should
  write LF.
- **pdfjs-dist is ESM-only**: `import('pdfjs-dist/legacy/build/pdf.mjs')` compiles (module
  commonjs) to `require()` of an external — works because Node ≥ 22.12 can `require()` ESM without
  top-level await. pdf.js collapses runs of spaces into one; it may detach the buffer it gets (pass a
  copy); `getDocument` has no `isEvalSupported` any more (v6).
- `detectDelimiter` (engine) looks at the **first line only**; a CSV with a one-cell preamble
  reads as comma-separated unless the spec sets `source.delimiter` — the AI sample guesses over 30
  lines and the prompt tells the model to set it.
- A Nest provider whose constructor has a defaulted function parameter (`fetchImpl = fetch`)
  cannot be `useClass`-bound (DI tries to resolve `Function`): bind it with `useFactory`.
- A wide `<pre>` in a dialog (the AI payload preview) needs `whitespace-pre-wrap break-all`, or it
  widens the whole dialog; the height is handled globally (see "Dialog actions never scroll away").
- `sqlite-url.spec.ts` compares against `path.resolve(...)`: surf-lend's copy hard-coded POSIX
  paths and only passed on Linux.
- Tools that write files can turn a BOM escape (U+FEFF) into the real character; in source build it
  with `String.fromCharCode(0xfeff)` (`rates/kursliste.ts`).
- PDF exports need Chromium for `playwright-core` (`pnpm exec playwright-core install chromium`,
  or `PDF_CHROMIUM_PATH`); without it the API answers 503 for PDFs, Excel still works.
- Rate adapters parse JSON with the reviver's **source text** (`parseJsonKeepingNumbers`) so a
  rate never becomes a JS number; Node ≥ 21 provides it.
- Several agents may share the Browser pane: pass `tabId` explicitly when driving it.
- **Desktop native module**: better-sqlite3 must have a **prebuilt binary for Electron's ABI**
  (GitHub release assets `better-sqlite3-v<x>-electron-v<abi>-<os>-<arch>.tar.gz`). 12.11.1 has
  them up to ABI 146 = **Electron 42**, which is why `electron` is pinned there (44 = ABI 149 has
  none, and @electron/rebuild then needs Visual Studio / Xcode). Before bumping either, check the
  asset list. Never let anything write into the workspace's `node_modules/better-sqlite3` (Node
  ABI, used by API and tests) — the desktop gets its own copy in `dist/apps/desktop-app`, installed
  with `packageImportMethod: copy` because pnpm's default hard links share the file with the store
  and every other checkout (a locked, shared `.node` showed up as EBUSY).
- The Nest `ConfigModule` validates `process.env` when the API bundle is loaded: the desktop sets
  the environment before `require`, and a new data folder needs a relaunch, not a restart.
- electron-builder resolves `--config` relative to `--projectDir`; the `desktop:package` target
  therefore runs in `dist/apps/desktop-app`. Config values inside a `configurations` entry of
  `project.json` are schema-checked (no `lk-note` there).
- electron-builder 26 collects `node_modules` itself (`pnpm list`): with a **hoisted** pnpm install
  it silently dropped nested versions (lazystream's readable-stream@2) and the packaged app died on
  `require('exceljs')`; with `beforeBuild` returning false it packaged **no** node_modules at all
  ("Cannot find module 'better-sqlite3'"). Check a package with `ELECTRON_RUN_AS_NODE=1
lazy-koins.exe -e "require('<…>/resources/app.asar/api/main.js')"` before clicking through it.
- Editing files from PowerShell 5.1 with `Get-Content`/`Set-Content` mangles UTF-8 (`—` → `â€”`) and
  adds a BOM — use the editor tools or Node.
