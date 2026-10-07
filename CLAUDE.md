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
> **packages** = F10.8/F10.9, data export F10.7, **tools / assistant / mcp** = F11.14–F11.16: one
> tool layer for the chat sidebar and the MCP server), the Angular web app (`apps/web`: login, the
> **Dashboard** (start page, first in the main navigation), project
> list with Vermögen/Ertrag, the project **workspace** with tabs Allgemein · Dateien · Hinweise ·
> Wallets · Kurse · Ergebnis · Prüfungen · Korrekturen · Exporte (tab bar in the sticky page header); the app-wide **activity indicator**; the global **Mappings** page = F11.0 in the main navigation;
> Profil and Einstellungen › Kurse/Wallets/AI behind the user menu; the **setup wizard** F11.0s and
> the **PIN lock** F11.0p, enforced by the API), the pure engine (`libs/engine`:
> money helpers, `Booking`/`Holding`, the **standard format "lazy-koins Buchungen v1"**, the
> **mapping spec** and its applier, F5.8 coverage hints, the **calculation** with rates, checks,
> corrections and analyses over any date, the golden test) and the infrastructure
> — ported from `surf-lend`. When in doubt about a convention, look at how surf-lend does it.
> **No per-platform importer code** (decided 06.10.2026): every platform is a mapping spec (JSON,
> stored per user). **Desktop app** (`apps/desktop`, Electron, see Desktop) and the **release /
> deploy pipeline** (`deploy/`, `.github/workflows/`) exist, and **wallets** (F6, see Wallets).
> **Not built yet:** bookings persisted as rows. Update this file whenever the code makes a section
> concrete or wrong.

## Stack

Same as surf-lend, minus mobile/Capacitor, Stripe, Firebase push, maps and analytics; plus
Electron for the desktop app (**Electron 42** + electron-builder, see Desktop).

### Shared

|                 |                                                                          |
| --------------- | ------------------------------------------------------------------------ |
| Node            | **22.23.2**, pinned via Volta in `package.json`                          |
| Package manager | **pnpm 11.21.0**, pinned via `packageManager` — do not use npm           |
| Nx              | 23.2.1 (exact; `@nx/devkit` is pinned to match in `pnpm-workspace.yaml`) |
| TypeScript      | 6.0.3                                                                    |
| Tests           | **Vitest** everywhere — one runner for every project                     |
| Numbers         | **decimal.js** for every quantity, price and CHF amount — see Numbers    |

### App (`apps/web`)

|         |                                                                                       |
| ------- | ------------------------------------------------------------------------------------- |
| Angular | 22.2, **standalone + zoneless**, esbuild (`@angular/build`)                           |
| UI      | **spartan.ng** — `@spartan-ng/brain` + generated "helm" components in `libs/ui`       |
| Styling | **Tailwind CSS v4** (CSS-first, `.postcssrc.json`) + token values in `src/styles.css` |
| Forms   | Typed reactive forms, validated with **Zod** (messages are i18n keys)                 |
| Data    | `httpResource` for reads, the **ActionRunner** for mutations                          |
| i18n    | **ngx-translate** v18, runtime JSON — `public/i18n/de-CH.json` + `en.json` (F11.2)    |
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
                       #   files (not private/reference/**), rates, calculation — prints totals only;
                       #   LK_UNLOCK_PIN=<pin> when the dev user has a PIN (F11.0p)
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
      rates/                #     Binance klines, CoinGecko, Frankfurter (ECB) — serialised, no key in logs;
                            #     ictax/ = the ESTV Kursliste (F7.4a): client, ZIP entry stream, SAX parser
      pdf/                  #     PlaywrightPdfRenderer (Chromium, lazily started)
    auth/                   #   AccessTokenGuard (global), PrincipalService, @Public, @CurrentUser
    users/                  #   GET /api/me
    projects/               #   the reference feature slice — copy its shape
    files/                  #   F5: upload (raw body), list, download, preview, assignment, templates
      application/          #     handlers, FileAnalysisService (engine runs), SourceFileReader (exceljs)
    mappings/               #   mapping specs: CRUD, JSON download, schema, project listing, usage (F11.0),
                            #   stateless sample-file inspect/preview for the editor
    ai/                     #   F5.13/F5.14: settings, payload preview, AI mappings (project file or editor sample), PDF statements
      domain/               #     pure: prompts, repair logic, statement checks, SSRF guard
    calculation/            #   F7–F9: input assembly + hash, calculate/result/drill-down, checks + open
                            #   items, corrections (undo/redo); testing/calculation-fixture.ts
    rates/                  #   F7.4: stored rates per project, refresh (ports), overrides, ESTV import;
                            #   F7.4a: automatic ESTV Kursliste (sync service + daily scheduler, matching)
    settings/               #   F11 profile data + CoinGecko/Etherscan keys (sealed), online rates on/off
    exports/                #   F10: Excel (ExcelJS, formulas) + HTML → PDF, stored exports, mail draft,
                            #   data export in the standard format (F10.7, data-export.handlers.ts)
    dashboard/              #   F11.4–F11.9: input across all projects, cache per input hash, user rate cache
    carryover/              #   F4.4a follow-up project, F4.4 take-over, ProjectBundle (one transaction)
    packages/               #   F10.8/F10.9: .lkproj.zip / account package (fflate), manifest + verification
    mail/                   #   F11.10/F10.6a: mailer + template settings, compose/send, send log
    tools/                  #   F11.14/F11.16: the ONE tool layer — registry, executor (policy + audit), definitions/
    assistant/              #   F11.14/F11.15: chat conversations, ChatEngine (tool loop, proposals), prompt
    mcp/                    #   F11.16: /api/mcp (SDK, stateless), PATs, MCP settings + audit endpoints
    setup/                  #   F11.0s: setup wizard progress + facts (what is configured)
    pin/                    #   F11.0p: PIN (scrypt), unlock sessions, PinLockGuard (423), forgot
    notifications/          #   F11.11–F11.13: NotificationService (raise/resolve by topic), ProjectNotifications,
                            #   list/count/read/dismiss, activity + sync-conflict reports (global module)
    common/crypto/          #   SecretBox (AES-256-GCM, SETTINGS_ENCRYPTION_KEY)
    common/http/            #   RawBodyMiddleware (uploads), contentDisposition()
    openapi/                #   document + Scalar
apps/web/                   # Angular app
  public/env.js             #   runtime configuration (window.__LK_ENV__) — see Runtime configuration
  public/i18n/de-CH.json    #   messages (German = the reference) + en.json (same keys, F11.2)
  src/styles.css            #   the ONLY place colours live (light + dark)
  src/app/
    core/                   #   actions/, api/, auth/, config/, i18n/, layout/, notifications/ (toasts),
                            #   notification-centre/ (bell + NotificationCentreService, F11.11), theme/,
                            #   pin/ (lock service, interceptor, lock screen), setup/ (state + guard)
    features/<feature>/     #   login, dashboard (page + project card), projects (+ follow-up page),
                            #   mappings (F11.0: list + detail), profile (+ account package), settings
                            #   (shell + rates/wallets/ai/mail; components/ = the forms shared with
                            #   the wizard), setup (F11.0s wizard), files and calculation (components only:
                            #   embedded in the project detail; project-workspace hosts the tabs, its
                            #   service is shared by them; ai-assist = the AI dialogs; mapping-editor =
                            #   the editor body of a project's new mapping; the mappings feature uses its own
                            #   components/mapping-workbench with a sample file)
    shared/format/          #   formatChf / formatQuantity / formatDate + lkChf / lkQuantity / lkDate / lkNumber
                            #   pipes (active format = a signal, F11.2; decimal.js)
    shared/ai/              #   aiErrorKey — the API's AI error codes → `ai.errors.<code>`
    shared/files/           #   saveBlob / fileNameFrom — authenticated downloads; filesByPlatform
    shared/charts/          #   hand-rolled SVG: lk-line-chart, lk-sparkline, lk-allocation-bar (no chart lib)
    shared/components/      #   records-dialog = the F7.5 drill-down (workspace + dashboard), empty-state, …
    shared/                 #   components/<c>/index.ts, forms/zod-validator
apps/desktop/               # Electron shell (see Desktop)
  src/main/                 #   main.ts (lifecycle, window, IPC, storage switch), api-host.ts, protocol.ts (app://)
    lib/                    #   PURE helpers, unit-tested without Electron: migrations, storage, lock-file,
                            #   sync-folder, web-protocol (routing, CSP, env.js), api-env, lock-watch (PIN)
  src/preload/preload.ts    #   window.lazykoinsDesktop (contextBridge) — types in src/shared/bridge.ts
  scripts/                  #   stage.mjs (assemble dist/apps/desktop-app), native-deps.cjs
  electron-builder.config.cjs, build/icon.png
libs/engine/                # PURE TypeScript (@lazykoins/engine), no Nest/Angular/Prisma/network/fs/clock
  src/money/                #   decimal.js helpers: parseDecimal (strings only), roundTo, format*
  src/bookings/booking.ts   #   Booking, Holding, BookingKind (the closed list of the standard format)
  src/importers/            #   importer.ts (Importer, SourceFile, ImportResult) + registry.ts + table.ts
    text/                   #     pure decoding: bytes→text (UTF-8/16, cp1252), CSV, numbers, timestamps
  src/standard/             #   standard format v1: German columns, zod row validation, template content
  src/mapping/              #   mapping spec (zod, JSON Schema export) + applyMapping + fingerprints,
                            #   sample.ts (the AI/editor sample, kindSummary), spec-skeleton.ts (Vorlage aus Datei)
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

**Hinweise (F5.8)** — `GET /api/projects/:id/hints` (`files/application/queries/project-hints.query.ts`)
= the engine's `missingFileHints` (kinds `noYearData` "Fehlende Datei", `startsLate`, `endsEarly`,
`noYearEndBalance`) + file hints (`unrecognisedFile` = needs a mapping, `rowErrors`), each with a
**stable key** (`<kind>:<platform>|<account>`, `noYearEndBalance:<platform>` for the whole
platform, `<kind>:<project file id>`), a severity (info/warning/error) and its status.
`PATCH …/hints` `{ key, status: open|done|ignored, note }` stores a dismissal in
`project_hint_state` (no row = open; 409 on a closed project) — it survives recalculation and new
uploads. Engine rules: a **statement** is a balance from a file without bookings for that account
(a ledger's running balance is not one); statements at 31.12. under accounts the ledger does not
use are **platform-wide** and cover every sub-account; no statement at all = **one** hint per
platform; an account whose ledger ends before 31.12. with every asset at 0 (`net` per asset is
stored in the coverage since this change — older rows lack it and count as "unknown") is `info`
and needs no statement. `GET …/files/:id/row-errors` lists the rows the file's own reader failed
on (row/code/column, no cell values). Web: tab **Hinweise** (`files/components/project-hints`,
badge = open count; the files area only shows "N Hinweise → anzeigen"); `ProjectFilesService`,
`MappingEditorState` and `AiAssistState` are provided by the **workspace** (shared with the hints
tab; `<lk-ai-assist>` lives there too). Checks link to the hints of a platform and back; file
issues are never open items.

Mappings are owner-scoped (`import_mapping`); a project lists the mappings its files use. Editing
one does not touch files until the user confirms `POST /api/mappings/:id/reapply` (closed projects
are skipped). Deleting one resets its files to `needs_mapping` in the same transaction.

**Mappings page (F11.0)** — `features/mappings`, `/app/mappings` in the main navigation: every
mapping of mine (`GET /api/mappings` adds `filesUsing` / `projectsUsing`, counted by the
database via `ProjectFileRepositoryPort.countByMappings`), search + sort, upload `.json`, new.
`/app/mappings/:id`: facts, JSON, edit (`lk-mapping-workbench` with a sample file — a file that
uses it is preloaded; see Beispieldatei below), save → offer re-apply, download, delete (lists the affected
files; disabled while a closed project uses it — the API's 409), and "Wird genutzt in"
(`GET /api/mappings/:id/usage`: projects newest year first, files linking to
`/app/projects/:id#file-<id>`, where the row is scrolled to and marked). The project's mappings
section only lists the mappings its files use (linking here), uploads a `.json`, starts
"Mit AI erstellen" and the editor of a new mapping for one file; edits happen on this page. After
a save from a project (editor, upload, AI) the toast links to the new mapping's page.

**Beispieldatei (sample file) in the mapping editor** — "Neues Mapping" (dialog, `sm:max-w-6xl`)
and editing on `/app/mappings/:id` use `features/mappings/components/mapping-workbench`
(component + `MappingWorkbenchService`, provided by the host page; the host owns save/cancel).
A sample is a CSV/XLSX from this computer (drop zone/picker) or a file of one of my projects
(its bytes downloaded via `…/content`); it is **held in the browser only** and sent with every
request — the API is **stateless** (`POST /api/mapping-samples/inspect|preview`, multipart
`file` + text fields, multer in memory, upload limits; `mappings/application/sample-file.ts`).
Inspect = the raw table as the AI would see it (`MappingSample`, preamble + header guess),
"Vorlage aus Datei" (`specSkeleton`, engine: header roles, date/number guesses, one `unknown`
rule per kind value — a new, untouched editor gets it automatically) and which reader an upload
would pick today. Preview = `applyMapping` on the whole file (debounced 600 ms while typing,
stale answers dropped; an invalid spec comes back as `valid: false` + issues, not a 400), kind
counts, unknown values, row errors, and the **fingerprint verdict** (`this | other | standard |
none`, decided like the upload: file read without the spec's CSV options, standard first, surest
mapping, tie → the one being saved; `mappingId` excludes the edited mapping). Its own per-account
budget (600 / 10 min). "Mit AI erstellen" from the sample: `POST /api/ai/mapping-sample/payload`
→ consent (nested dialog) → `POST /api/ai/mapping-sample` (same `MappingWriter` round trip as for
project files) → the proposal lands in the editor; saving it uses `POST
/api/ai/mapping-sample/accept` (origin `ai`). After saving a new mapping, "auch hinzufügen zu
<Projekt>" uploads the sample through the normal upload and PATCHes it to the new mapping if
another reader won. On the mapping page the first file that uses the mapping is preloaded as the
sample. Nothing about the sample is stored unless the user adds it to a project.
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
- **Mapping** (`POST /api/projects/:p/files/:f/ai/mapping`): sample (`libs/engine/src/mapping/sample.ts`:
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
  `http://localhost:11435/v1`; answers the synthetic fixtures' mappings and simple statements,
  and — for requests with `tools` — a scripted chat, see Assistant below).

## Tool layer, AI assistant, MCP server (F11.14–F11.16)

**One tool layer** (`apps/api/src/tools/`, `ToolsModule`): the chat and the MCP server call the
same typed tools — never two implementations.

- **Definitions** (`tools/definitions/<area>.tools.ts`, built by `buildTools(services)`): name
  (`snake_case`), German `title`, English `description` (for the model), `area` (`projects |
files | mappings | rates | results | checks | corrections | exports | wallets | settings |
mail`, plus `ui` = chat-only), `effect` (`readOnly | write | destructive`), optional `channels`
  (`request_file_upload` / `navigate` are chat-only, `upload_file` (base64, ≤ 5 MB) MCP-only),
  zod `input` and `output`, `run(context, input)` and an optional `preview` (proposal card:
  summary + before/after lines). `run` calls the **existing service façades** (ProjectsService,
  FilesService, … — the feature modules export them) with `context.userId`, so owner scoping,
  closed-project 409s and validation stay where they are; never Prisma.
- **The output schema is an allow-list**: the executor parses every result through it (zod strips
  unknown keys) — that is how `get_settings` can never return a key, a key hint or a password.
  Results carry relative app links (`/app/projects/:id?tab=result&figure=<figureId>`,
  `?tab=files#file-<id>`, `/app/mappings/:id`) and are capped (`limit`, `truncated`) —
  data minimisation: the model fetches details with read tools, the prompt holds only the page
  context. **Amounts carry their currency** (F4.1a): project, result, positions, income, checks,
  calculate, exports and rates outputs have `currency` (the snapshot's or the project's tax
  currency) — the `…Chf` field names are historical; price overrides are in that currency.
- **`ToolRegistry`** (catalogue, `jsonSchemaOf` = `z.toJSONSchema`, `io` input/output, `$schema`
  removed; `forChat()`, `forMcp({ areas, allowWrite })`) and **`ToolExecutor.call(context, name,
args, { policy?, confirmed? })`**: validate (zod issues → `invalidArguments`), policy (MCP: area
  off → `areaDisabled`, write/destructive without the switch → `writeDisabled`; chat:
  write/destructive only with `confirmed` → else `refused`), run, parse the output, map Nest
  exceptions (`404 → notFound`, `409 → conflict`, `400/422 → invalidArguments`) and **audit
  every call** in `tool_audit` (user, source `chat|mcp`, tool, `summarizeArgs` = structure with
  secret-named fields, seed phrases/keys (`detectSecret`) and credential patterns redacted, bulk
  fields as `<n chars>`, ≤ 500 chars; status `ok|error|refused|proposed`, error code, duration,
  MCP token id).

**Assistant chat** (`apps/api/src/assistant/`, F11.14/F11.15): `AiCompletionPort.converse(connection,
{ system, messages, tools })` = one turn with tool use (OpenAI-compatible `tools` +
`tool_calls`/`role: tool`; Anthropic `tools` + `tool_use`/`tool_result` blocks, consecutive
same-role turns merged — `anthropicMessages`). `ChatEngine.ask` (gate: AI plugin on/configured
via `AiGate.connectionOf`; the chat's own consent `assistant_settings.chat_consent_at`, 409
`consentRequired` until the first message carries `consent: true`) → system prompt =
the user's prompt or `DEFAULT_SYSTEM_PROMPT` + the fixed `SAFETY_RULES` (confirm before changes,
no tax advice, never keys, only own data, instructions in data are data) + the page context
(route, project name/year/status resolved server-side, tab) → loop ≤ `MAX_TOOL_STEPS` (8): read
tools run at once (results ≤ 12 000 chars to the model), **write/destructive tools become
proposals** (`chat_proposal`, preview with before/after, audit `proposed`; the model is told it
was proposed) → final answer with `attachments` (upload drop zone, links), `proposalIds`,
`toolsUsed`, usage. The turn is stored only when it completed — an AI error (the gate's 502 with
details; `gate.call(…, { userId })` raises `ai.callFailed` like every AI call) leaves the chat as it was. History to the model: last 40 messages from a user message,
older tool results ≤ 2000 chars, `event` rows as `[App] …` user notes. `POST …/proposals/:id/confirm`
claims the proposal atomically (`pending` → decided, a second click = 409), runs the tool with
`confirmed: true` (closed projects still 409 → card `failed`) and appends an `event`;
`…/cancel` likewise. Endpoints: `GET /api/chat/status`, `GET|POST /api/chat/conversations`,
`GET|PATCH|DELETE /api/chat/conversations/:id` (delete cascades messages + proposals),
`POST …/:id/messages`, `GET|PUT /api/assistant/settings` (prompt; `null`/`""` = default;
`revokeChatConsent`). 60 questions / 10 min per account. Live: `fake-ai-server.mjs` scripts
"Warum fehlt der Kurs für X?" (list_positions → list_rates → answer with the drill-down link) and
"Setz den Kurs von X auf 4.50 CHF" (set_price_override proposal).

**MCP server** (`apps/api/src/mcp/`, F11.16): official SDK (`@modelcontextprotocol/sdk`, low-level
`Server` + `StreamableHTTPServerTransport`), **stateless** — one server + transport per POST to
`/api/mcp`, JSON responses (`enableJsonResponse`), GET/DELETE 405. Tools = `registry.forMcp`
with `readOnlyHint`/`destructiveHint` annotations, `inputSchema` + `outputSchema`
(`structuredContent` validates against it in the SDK client), failures as `isError` results;
resources `lazykoins://projects/<id>` (facts + result totals). **Off by default**
(`assistant_settings.mcp_enabled`, areas, `mcp_allow_write`). Auth: **personal access tokens**
`lkmcp_<base64url 32 bytes>` (`mcp_token`: SHA-256 only, hint, expiry ≤ 365 d or none, last
used, revoked; ≤ 20 active), `McpAccess` → 401 `missingToken|invalidToken|tokenRevoked|
tokenExpired`, 403 `mcpDisabled`, 429 `rateLimited` (120 requests/min per token, in memory).
**PIN lock (F11.0p, decided 08.10.2026)**: the chat's endpoints are ordinary data routes, so
`PinLockGuard` locks them like everything else. MCP has no browser session: on the **desktop** a
token is refused with **423 `pinLocked`** while the user has a PIN and no unlocked session
(`PinSessions.isUnlocked`, which does not renew — MCP traffic never keeps the app open); on the
**web** the PAT is its own credential (MCP-only, hashed, expiry, revocable), so the browser's PIN
lock does not apply to it. The route is `@Public()` and skips the per-account write budget; `AccessTokenGuard` never verifies
a `lkmcp_` token as an ID token and refuses it on every other route (also in local mode — no
ambient fallback). `bootstrap.ts` gives `/api/mcp` an 8 MB JSON limit (`mcpBodyParser`, see
gotchas). Settings: `GET|PUT /api/settings/mcp` (+ endpoint, mode web/desktop, tool list),
`GET|POST /api/settings/mcp/tokens`, `DELETE …/tokens/:id` (revoke), `GET /api/settings/mcp/audit?source=`.
**Desktop**: the API listens on 127.0.0.1 with a per-launch port; `requireAccessToken` lets
exactly `/api/mcp` with a `lkmcp_` bearer through (the route checks it); the app writes
`<dataDir>/mcp-endpoint.json` (`lib/mcp-endpoint.ts`, removed on quit) and ships the **stdio
proxy** `mcp-stdio.js` (`src/mcp/stdio-proxy.ts`, esbuild entry in `stage.mjs`, in the
electron-builder `files`): SDK `StdioServerTransport` ↔ `forwardMcpMessage` (pure,
`lib/mcp-forward.ts`: POST with the token, SSE or JSON answers, transport problems as JSON-RPC
errors) — the endpoint is looked up per message (`LAZYKOINS_MCP_URL`, `LAZYKOINS_DATA_DIR`, or
the packaged app's data folder). Run as `ELECTRON_RUN_AS_NODE=1 <lazy-koins.exe>
<app.asar>/mcp-stdio.js` with `LAZYKOINS_MCP_TOKEN`; the bridge's `mcp.stdio()` (IPC
`lk:mcp:stdio`) gives the settings page the exact command. Dev check:
`LAZYKOINS_MCP_TOKEN[_FILE]=… node scripts/dev/mcp-client.mjs <endpoint> [tool] [json]` or
`--stdio <mcp-stdio.js>`.

**User scoping guarantees (F11.16, user rule 08.10.2026: "über MCP dürfen keine Sachen
vorgenommen werden, die andere User betreffen")** — every MCP and chat tool action is strictly
limited to the authenticated user:

- **Identity only from authentication**: MCP = the PAT (`McpAccess`: SHA-256 lookup, revoked /
  expired / MCP off refused, the token's `userId`); chat = the signed-in user of the route. Never
  from tool arguments, headers, MCP `_meta`, resource URIs or a session id (stateless: one
  `Server` + transport per request; the only module-level state is the per-token rate window and
  the registry's schema cache, neither holds user data).
- **One immutable context**: `toolContext()` (`tools/domain/tool-scope.ts`) builds the frozen
  `ToolContext { userId, source, tokenId? }`; `ToolExecutor.call` rebuilds it on every call, so a
  tool cannot change who it acts for. `createMcpServer` and `ChatEngine` use it.
- **No identity arguments**: the registry refuses to register a tool whose input schema has a
  field named like a user (`userId`, `ownerId`, `owner_email`, `tenantId`, `accountHolder`,
  `uid`, … — `isIdentityField`; `accountId` = an exchange account and a mail `subject` are fine),
  and `ToolExecutor.parse` refuses such top-level arguments with `refused` (audited) — the chat's
  proposal path included.
- **Owner checks stay in the handlers** (`loadOwnProject`, `loadOwnProjectFile`,
  `loadOwnMapping`, `loadOwnWallet`, conversation/proposal/token/notification checks): another
  user's id reads as **404**, never 403. Stored files dedupe per owner (`(owner_id, sha256)`),
  mapping detection uses only the owner's mappings. Defence in depth: the calculation, dashboard,
  package export and row errors use a file's mapping only when it belongs to the owner;
  `ProjectFileRepositoryPort.add` and `ProjectBundleRepositoryPort.write` refuse a stored file,
  mapping, wallet or target project of another owner. The ESTV tables are read-only for tools;
  PAT management and the audit log are **not** tools (settings routes of the signed-in user).
- **Tested**: `tool-scoping.spec.ts` (schema scan over the whole registry, refusal of identity
  arguments, frozen context) and **`tools/tools.isolation.integration.spec.ts`** (the real
  AppModule on the test database, users A and B with full data — same file bytes, same mapping
  fingerprint, wallet, calculation, correction, export, notification, conversation with a pending
  proposal, PAT): every registry tool is called as B with A's ids on every channel (`CASES` —
  **a tool without a case fails the suite**: a new tool must add how it is attacked), must fail
  with `notFound` (or the stated code) and nothing B sees may contain A's data; a positive
  control runs the read tools on B's own ids; previews, conversations/proposals,
  notifications, tokens and the audit log over HTTP; MCP end to end with the SDK client and B's
  PAT (resources, tools, `_meta`, identity arguments, PAT on other routes, dev token on MCP); A's
  data read before and after must be equal.

**Web**: `core/assistant/` — `ChatService` (root: status, conversations, ask/confirm/cancel,
consent notice, AI error panel state), `chat-sidebar` in the app shell (header toggle, open state
in localStorage; beside the page from `lg`, an overlay with backdrop below; only the message list
scrolls; without a usable AI plugin a hint links to the wizard's AI step `/app/setup?step=ai`), `chat-message` (safe minimal markdown via `chat-markdown.ts`: text through
`textContent`, only relative `/app/…` links become router links), `proposal-card`
(before → after, "Ausführen" / "Abbrechen", outcome), `chat-upload` (drop zone → the normal
upload endpoint), `ChatContextService` (the workspace publishes project + tab); a confirmed
proposal is reported to `DataChanges` with its `projectId` (every scope), a chat upload by the
interceptor like any upload — see "Data refresh". The project workspace reads `?tab=` and `&figure=` (opens
the drill-down) — the links the tools return. Einstellungen › AI has the "Assistent" section
(prompt, reset, fixed rules read-only, consent revoke); Einstellungen › MCP
(`features/settings/pages/mcp-settings-page`): switches, areas, endpoint, config snippets (Claude
Desktop via `mcp-remote`, Claude Code, generic; stdio from the desktop bridge's `mcp.stdio()`),
tokens (created token shown once), tool list by area, audit table.

**Database** (migration `20261008180000_ai_chat_mcp`, new tables only, all cascade with the
user): `assistant_settings` (PK user; prompt 1–8000 or NULL, areas JSON array), `mcp_token`
(64-hex hash unique, name/hint CHECKs), `chat_conversation` (title CHECK), `chat_message`
(unique `(conversation, seq)`, role `user|assistant|tool|event`, data JSON object),
`chat_proposal` (status CHECK, JSON CHECKs, `decided_at` set iff not pending), `tool_audit`
(source/status CHECKs, args ≤ 2000, no FK to the token). `assistant.persistence.integration.spec.ts`.

## Mail to the Treuhänder (F11.10, F10.6a, F4.7)

Optional: without a mailer the "An Treuhänder senden" dialog offers the text to copy and a
`mailto:` link (no attachments). Slice `mail/` (API) + `features/settings/pages/mail-settings-page`
and `features/calculation/components/send-to-advisor` (web).

- **Mailer** (`mail_settings`, Einstellungen › Mail `/app/settings/mail`): host, port, security
  `starttls | tls | none`, user, password **sealed with SecretBox** (hint only, never returned or
  logged), sender name/address, on/off. `MailTransportPort` (`integrations/mail/`) → nodemailer,
  one connection per mail: 15 s connect/greeting, 60 s socket timeout, TLS certificates always
  verified, `requireTLS` for STARTTLS, file/URL access off. Failures become `MailTransportError`
  with `{ kind: auth|tls|connection|dns|timeout|rejected|protocol|unknown, host, port, smtpCode,
response, command, code }`, **redacted** (`redact.ts`: password, its base64, the AUTH PLAIN
  token, anything after `AUTH …`) → 502 `code: smtpFailed`, `smtp: {…}`; the app shows them
  (`lk-smtp-error`). **SSRF guard**: private/loopback SMTP hosts refused unless
  `MAIL_ALLOW_PRIVATE_HOSTS` (empty = allowed with `AUTH_MODE=local|dev`, refused with
  `firebase`), literal host check like the AI plugin. "Test-Mail an mich senden"
  (`POST /api/mail/settings/test`) works on the **unsaved form values** (a typed password is used,
  never stored) and goes to the account's address (the sender address for `*.local` accounts).
- **Template** (`mail_template` per user + language; no row = the built-in default in
  `mail/domain/mail-template.ts`, the F10.6 draft with the open questions): placeholders
  `{{name}} {{treuhaender}} {{steuerjahr}} {{kanton}} {{vermoegen}} {{ertrag}} {{anhaenge}}
{{offene_punkte}} {{datum}} {{projekt}}`. The renderer is **logic-less and one-pass**: known
  names are replaced by values made safe for plain text (control characters out, the subject on
  one line — no header injection), unknown ones stay as typed and are reported; saving a template
  with unknown placeholders is a 422 (`unknownPlaceholders`). Live preview with invented sample
  values (`POST /api/mail/template/preview`, debounced), reset = `DELETE /api/mail/template`.
- **Send** (`POST /api/projects/:id/mail/compose` → dialog → `…/mail/send`): recipient from the
  profile (editable), CC me, subject/body from the template with the latest snapshot (no
  recalculation; `–` before the first one), the stored statements as attachments — the latest
  per kind preselected, internal reports (`internal_report_*`) never, with a warning; ≤ 20 MB
  together (422 `attachmentsTooLarge`); changing the selection re-renders `{{anhaenge}}` unless
  the text was edited. Compose → **confirmation step** → send (`confirmed: true` required, else
  400). Every attempt is logged in `mail_log` (to, cc, subject, attachment names/sizes,
  sent/failed + redacted error; never the password, not the body); allowed on closed projects
  like the exports. 20 sends / 10 min per account.
- **F4.7** (`project_sent_state`, `projects/…/sent.handlers.ts`): set automatically by a
  successful send (via `mail`, recipient, exports, log id) or by hand (`PUT /api/projects/:id/sent`:
  date — today = now, earlier = end of that day — way `mail|post|personal|other`, note, exports);
  `DELETE` = rückgängig (the log stays). Allowed on closed projects. "Seit dem Versand geändert"
  (`changesSinceSent`, pure): a newer snapshot with a **different input hash** than at sending,
  a statement created afterwards that was not sent, a correction made/undone or a file added
  afterwards. The list carries `sent: { sentAt, via, changedSince }`; badge
  `lk-project-sent-badge` in list and detail header; both follow every change to the project
  through `DataChanges` (see "Data refresh").
- Live: `node scripts/dev/smtp-sink.mjs [port]` (127.0.0.1:2525, security "Keine", any user;
  user `reject` → auth error, recipient `bounce@…` → 550) writes each mail to `tmp/smtp-sink/`.
  Tests: fake transport (`mail/testing/mail-doubles.ts`) for handlers, the real nodemailer adapter
  against an in-process `smtp-server` sink — never a real mail.

## Setup wizard and PIN lock (F11.0s, F11.0p)

**Wizard** (`/app/setup`, `features/setup`; API slice `setup/`, table `setup_progress`): steps
Profil (required) · Treuhänder · AI-Plugin · Kurse · Wallets & Netzwerke · Mail · Speicherort
(desktop only) · PIN (required on the desktop, optional on the web) · Zusammenfassung. Progress per
user (`steps` JSON: `open|done|skipped|error`, `current_step`, `completed_at`) → `GET|PATCH
/api/setup`, `POST /api/setup/complete` ("App starten" / "Erstes Projekt anlegen"). The API refuses
`skipped` for a required step and `done` without its settings (profile: name + Wohnkanton; PIN: a
PIN) — 422 `stepRequired|stepIncomplete`; `complete` = `completed_at` set **and** nothing required
missing (the desktop's PIN after "PIN vergessen" reopens it). `facts` (what is configured) are read
from the slices' own ports (`SetupFactsReader`, never opens a key) and drive the summary's "what a
gap means". `setupGuard` (`core/setup/setup-state.service.ts`, `canActivateChild` on `/app`)
sends every page there until finished (API unreachable → the app opens); the shell hides the main
navigation meanwhile. Re-open: Einstellungen › System "Einrichtung erneut durchlaufen".
Deep links `/app/setup?step=ai|rates|mail` from the AI "nicht eingerichtet" dialogs, the
Treuhänder mail without mailer, the project's Kurse tab and the dashboard when lookups are off.

- **The steps reuse the settings**: the forms are extracted components used by both —
  `features/settings/components/ai-settings-form` (`lk-ai-settings-form`), `mailer-form`,
  `rates-key-form` (online on/off + CoinGecko key + **Testen** = `POST
/api/settings/keys/coingecko/test`, `KeyCheckResult` with code/status/provider message/URL →
  `lk-key-check-result`), storage via `StorageSettingsPageService`. `embedded` hides their save
  button and their success toast (it would sit on "Weiter"); the page's "Weiter" calls
  `submit()` of the step on screen (`SetupStepComponent` token, `provideSetupStep`). The AI step
  can give the F5.14 consent up front (`giveConsent` on `PUT /api/ai/settings`; the payload is
  still shown before every request). Wallets: the Etherscan and Helius keys with "Testen" through
  `WalletSettingsPageService` (`/api/settings/wallets`, `…/test`); the other networks stay in
  Einstellungen › Wallets & Netzwerke.

**PIN** (API slice `pin/`, table `user_pin`): 4–8 digits, stored only as **scrypt**
(`pin/domain/pin-hash.ts`: N = 2^15, r = 8, p = 1, 16-byte salt, 32-byte key, parameters inside the
hash `scrypt$15$8$1$<salt>$<hash>`, `needsRehash`), never logged. Wrong attempts are persisted
(`failed_attempts`, `next_attempt_at`): wait 0, 1, 2, 5, 10, 30, 60 … 900 s; one check per user at
a time (`PinPolicy.serial`). Web: after 10 failures `reloginRequired` until a sign-in **after** that
moment (the identity's `authTime` = Firebase `auth_time`; the dev token carries it as
`dev:<email>#<epoch ms>`). "PIN vergessen": desktop = `POST /api/pin/forgot {confirmClearKeys:
true}` removes the PIN **and every sealed key** (AI key, mail password, CoinGecko, Etherscan,
Helius, Subscan — `SealedKeysEraser`; a new sealed key elsewhere must be added there); web = only with a sign-in ≤ 10 min old (the lock screen signs out, remembers
it in localStorage and resets after the new sign-in). Auto-lock 1–240 min (default 15).

- **Enforced in the API**: `PinLockGuard` (global, after `AccessTokenGuard`) answers **423
  `pinLocked`** to every request of a user with a PIN that lacks a valid `x-lazykoins-unlock`
  token. `@AllowWhileLocked()`: `GET /pin/status`, `POST /pin/unlock|lock|forgot`, `GET /me`.
  Unlock tokens live **in memory** (`PinSessions`, only their SHA-256, sliding expiry = the
  auto-lock time, ≤ 20 per user) — every API (re)start locks everyone, which is the desktop's
  "PIN on every start". Changing the PIN ends the user's other sessions.
- **Web**: `PinLockService` (`core/pin`) keeps the token in **sessionStorage** (a new tab after
  the app was closed has none → locked; an open tab shares its token over a BroadcastChannel), an
  idle timer (DOM input) locks and activity renews (`POST /pin/renew`, ≤ 1/min).
  `unlockInterceptor` adds the header, **holds** data requests while locked and re-sends a
  request that got 423 after the PIN was entered. `lk-lock-screen` (root, app behind it
  `inert`): PIN field + pad, error with countdown/attempts left, "PIN vergessen", sign-out (web).
  User menu "Jetzt sperren"; Profil › PIN-Sperre (change with the current PIN, auto-lock, remove on
  the web).
- **Desktop**: `RunningApi.lockAll()` (bootstrap) revokes every session; `lib/lock-watch.ts`
  (pure, unit-tested) locks on `powerMonitor` `lock-screen`/`suspend` and on system idle ≥ the
  user's auto-lock time (the window reports it via `lazykoinsDesktop.lock.setIdleMinutes`), and
  main.ts tells the window (`lock.onLocked`).
- The PIN guards an open app, not the files: whoever copies the data folder (database + key file)
  can try all PINs offline.

## Notifications (F11.11–F11.13)

The bell in the header (`core/notification-centre/notification-bell`, next to the theme toggle)
with the unread badge; its panel (dialog layout: header with "Erledigte ausblenden", the only
scrolling list grouped by project, footer "Alle als gelesen" / "Alle anzeigen"; Escape and a
click outside close it, focus back on the bell) and the page `/app/notifications`
(`features/notifications`, table pattern: truncate, row actions open/read/dismiss, paginator,
filters kind / project / status). Slice `notifications/` (API), global module.

- **Model** (`notification`, migration `20261008160000_notifications`, new table only): per user,
  `kind` `error | action | info | success`, **topic** (unique per user — the dedupe key), project
  (nullable, cascade), `title_key` (`notifications.%`) + `params` (JSON object), `action` (JSON
  `{ labelKey, route under /app/, query?, fragment?, named? }`), `created_at` (first raise),
  `occurred_at` (last raise — the sort key), `read_at`, `resolved_at`, `dismissed_at`. CHECKs in the
  CREATE TABLE; `notifications.persistence.integration.spec.ts`.
- **Topic naming**: `<area>.<what>[:<subject>]`, built only through `Topics` in
  `notifications/domain/notification.ts`; the title key is `notifications.title.<area>.<what>`
  (`TITLE_BASES`, mirrored in the web's `NOTIFICATION_TITLE_BASES`; a spec checks de-CH has every
  one). Project topics end in the project id, file topics in the project file id.
- **`NotificationService`** (`raise`, `resolve`, `resolveWhere`, `toggle`): upsert by topic. An
  `event` (error/info/success) is news on every raise (unread, back from resolved/dismissed); a
  `condition` (`action`) only when its content changed or it had been resolved — a recalculation
  with the same 3 open items does not ring again, a dismissed one stays hidden. Params pass
  `sanitizeParams` (flat values, ≤ 200 chars, keys/tokens/passwords/seed phrases/private keys →
  `[…]`), actions `sanitizeAction` (app routes only). Storage errors are logged, never thrown into
  the triggering operation. Resolved/dismissed rows older than 30 days are pruned on the next raise.
  Handlers get it (and `ProjectNotifications`) as `@Optional()` last constructor parameters, so
  specs that do not care construct them as before.
- **`ProjectNotifications`** re-derives a project's conditions from stored state after every change
  that can affect them, raising what is true and resolving the rest: `filesChanged` (upload,
  derived file, assignment, remove, re-apply, mapping deleted, carry-over, package import),
  `hintsChanged`, `calculated`, `openItemsChanged`, `sentChanged` (send, mark, undo, export,
  correction). A hint marked done/ignored settles the matching file topic.
- **Triggers** (F11.12):

  | Topic                                             | Kind            | Raised by / resolved by                                                                                            |
  | ------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
  | `rates.fetchFailed:<p>` (assets)                  | error           | "Kurse aktualisieren" with failed assets / a clean refresh; `retry:rates`                                          |
  | `key.invalid:coingecko`                           | action          | CoinGecko 401/403 in a refresh / key accepted or saved                                                             |
  | `estv.fetchFailed:<year>`                         | error           | scheduler **and** manual check fails (owners of the year's open projects + requester) / next success; `retry:estv` |
  | `estv.newVersion:<p>`                             | info            | a new Kursliste stored / the project applies it (`EstvProjectRatesService`)                                        |
  | `ai.callFailed`, `key.invalid:ai`                 | error / action  | `AiGate.call` with a context (code + HTTP status only) / a successful call, saved key                              |
  | `mail.sendFailed:<p>`, `key.invalid:mail`         | error / action  | failed send (kind; auth → key) / successful send, test with the saved password, settings saved                     |
  | `mail.sent:<p>`                                   | success         | successful send                                                                                                    |
  | `export.failed:<p>`                               | error           | statement creation failed / next one succeeds                                                                      |
  | `package.importFailed`                            | error           | project/account package import (its code) / next import                                                            |
  | `file.needsMapping:<pf>`, `file.rowErrors:<pf>`   | action          | `ProjectNotifications.fileTopics` / file mapped, hint settled, file gone                                           |
  | `file.readFailed:<p>`                             | error           | upload that cannot be read (422; the name only)                                                                    |
  | `hints.open:<p>`                                  | action          | open F5.8 coverage hints (warnings/errors) / none left                                                             |
  | `checks.openItems:<p>`, `rates.missingPrices:<p>` | action          | after a calculation (count) / ticked off, recalculated without                                                     |
  | `project.changedSinceSent:<p>`                    | action          | `changesSinceSent` non-empty (F4.7) / sent again or undone                                                         |
  | `desktop.syncConflict`                            | action          | desktop app reports conflict copies at start (`PUT …/sync-conflict`)                                               |
  | `setup.incomplete`                                | action          | wizard finished with skipped/open optional steps still missing settings / all set up (below)                       |
  | `task.done:<label>[:<p>]`, `task.failed:…`        | success / error | the app's activity report (below)                                                                                  |

  Plus `wallet.fetchFailed:<wallet>` (error: label, failed networks, first code — never the
  address; resolved by a fetch without failures) and `key.invalid:chain` (a network's 401/403 →
  Einstellungen › Wallets) from `FetchWalletHandler`. And `setup.incomplete` (action, condition,
  F11.0s): `SetupViews.present` re-derives it whenever the wizard is read or changed — raised
  once "App starten" was pressed while optional steps were skipped/left open **and** their
  settings are still missing (`setupGaps`: Treuhänder, AI, CoinGecko, Etherscan, Mailer, web PIN;
  params `count` + `steps`, button "Einrichten" → `/app/setup?step=<first gap>`), resolved when
  none is left.

- **API**: `GET /api/notifications?status=unread|all&includeResolved&kind&projectId&offset&limit`
  (newest first, ≤ 500, `{ items, total, unread }`), `GET …/count`, `POST …/:id/read`,
  `POST …/read-all`, `POST …/:id/dismiss` (someone else's id → 404), `POST …/activity`,
  `PUT …/sync-conflict`.
- **Web** (`NotificationCentreService`, root): polls the list every 60 s while the shell lives
  and after every finished task; translates code params (`reason` → `notifications.reason.*`,
  `code` → `ai.errors.*`, `kind` → `exports.kind.*`, `reasons` → `projects.sent.reason.*`, `task`
  → the activity label); `open()` marks read, runs a named action (`retry:rates` posts the refresh
  through the ActivityService, `retry:estv` starts the update) and navigates — `?tab=` opens a
  workspace tab (`ProjectDetailPage.tab` → `ProjectWorkspace.initialTab`), `#file-<id>` marks the
  file row. **F11.13**: `ActivityService.finished` emits every ended task with the URL at start and
  end; the centre reports failures and tasks finished after the user left their page
  (`POST /api/notifications/activity`; the server skips a failure it already notified within 2
  min, checks project ownership, accepts only `activity.*` labels).
- **Desktop**: `window.lazykoinsDesktop.notifications` (`enabled`, `setEnabled`, `show`) →
  Electron `Notification` for new unread `error`/`action` items (never what was there at start),
  only while "System-Benachrichtigungen" (Einstellungen › System, stored in
  `desktop-config.json` as `systemNotifications`, default on) is on; input validated by
  `lib/os-notification.ts`; click focuses the window; `setAppUserModelId` on Windows. Never in the
  web.

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
    preferred, only checked. A **platform-wide statement** (31.12. balances only under accounts
    the ledger does not use — one Kraken statement for spot + earn; `platformWideStatements` in
    `balances.ts`, the same rule as the F5.8 hints) **replaces** the ledger positions of all the
    platform's accounts (no double count), and ledger = statement is then checked on the summed
    ledger per asset (`ledgerVsStatement:<platform>|*|<asset>`). ENGINE_VERSION 4 (2 = this rule, 3 = the wallet check,
    4 = the tax currency, see Tax currency).
    Manual holdings (corrections) replace their asset. |q| < 1e-7 dropped;
    spam (name matches `claim`, or a `spam` booking) and negative positions stay listed but are not
    in the total.
- **Price priority** (`rates/rate-table.ts` `unitPriceChf`, in the tax currency T, CHF by default):
  T = 1 → override in T (`manual` rate, F9.1/F7.4) → ESTV (same day; **only T = CHF**) → the
  record's CHF price (only T = CHF) → the record's USD price × USD/T → stablecoins/USD = 1 USD ×
  USD/T, other fiat via its rate in T → stored price in T → stored USD price × USD/T; prices at
  most 14 days before, else at most 14 days after; FX forward-filled, cross rates (see Tax currency).
- **Income** (F7.2) of the year at arrival (UTC day), **net** after a fee in the same asset, gross
  as info. A booking with its own USD value (`valueUsd`/`feeValueUsd`, mapping fields — Kraken
  `amountusd`/`feeusd`) is valued `(valueUsd − feeValueUsd) × USD/CHF of the day`.
- **Earn gap** for every account with statement balances at both year ends and bookings in the
  year: `(end − start) − Σ bookings without transfers`; positive → income at the yearly average
  (daily USD × USD/CHF), negative → open item; EUR, USDT excluded (country rules).
- **Checks** (F8.1) with lights + **open items** with a stable `key`, reason, params and CHF
  impact (F8.2): ledger = statement (exact) + running-balance consistency + negative balances,
  Earn gap, withdrawals ↔ deposits across own accounts (±2 %, −1 h … +7 d, fiat ignored), opening =
  previous closing, missing prices, unclassified bookings, wallet networks (F6.4, see Wallets).
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
unless `force`; `GET …/rates/refresh/status` = progress of the refresh in flight, in memory —
`RefreshProgress`; `RATES_DEV_DELAY_MS` slows each series down, development only),
`PUT|DELETE …/rates/manual`, `POST …/rates/estv` (raw file body). Refused (409)
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

## Tax currency (F4.1, F4.1a)

Every project has a **tax currency** `project.tax_currency` (ISO 4217, CHECK 3 upper-case letters;
migration `20261008170000_tax_currency`, which also widens the `currency` CHECK of `project_rate`
and `user_rate` from CHF/USD to any code). Default from the country rules
(`CountryRules.defaultTaxCurrency`, CH → CHF); the API accepts `TAX_CURRENCIES` (engine: the ECB
currencies Frankfurter serves). Existing projects and **older packages** are CHF.

- **Engine**: `withTaxCurrency(rules, T)` = the country's rules with `homeCurrency = T` (T counts
  as fiat); the CH rules for CHF are returned unchanged, so a CHF project computes exactly as before.
  `new RateTable(entries, T)`: `fx(base, date)` = base in T — the stored pair, else the inverse
  pair, else a **cross rate** through USD, EUR or CHF (GBP in EUR = GBP/USD × USD/EUR); `fxDays`
  for the yearly average. Price overrides (`price_override.priceChf`) are in T
  (`applyCorrections(…, T)`). `CalculationResult.currency` / `DashboardResult.currency` name T;
  **the `…Chf` field names stay** (stored snapshots, API types) and hold amounts in T —
  `parameters.usdChf/eurChf` are USD/T and EUR/T. Snapshots of engine ≤ 3 are read as CHF
  (`calculation.prisma.repository.ts`).
- **API**: `projectRules(project)` (`calculation-input.service.ts`) everywhere a calculation runs;
  the currency is part of the input hash → changing it makes the snapshot **stale**; the previous
  year only counts with the same currency. Create/PATCH take `taxCurrency` (closed = 409 as
  always). Rates: `fxBasesFor(T)` = USD and EUR (minus T) via `FxRateSourcePort.daily(base, T)`
  (Frankfurter `?from=USD&to=EUR`), CoinGecko `FiatPriceSourcePort.dailyFiat` with
  `vs_currency = T`, Binance stays USD; a series counts as cached only in USD or T. ESTV
  (`estvApplies`) only for CHF: no apply, `GET …/rates` has `currency` and `estv.applicable`;
  overrides in T or USD (fx only in T, else 400).
- **Exports**: labels from T ("Wert EUR", "Steuerwert EUR", "USD/EUR per 31.12."), named cells
  `fxCellName(base, T)` = `USDEUR`/`EUREUR` (CHF: `USDCHF`/`EURCHF`) — formulas unchanged in
  structure; `priceSourceText(…, T)`; the method text without ESTV for T ≠ CHF; the data export's
  info columns `exportExtraColumns(T)`. The exports use the **snapshot's** currency.
- **Mail**: `{{vermoegen}}`/`{{ertrag}}` include the currency ("EUR 12'345.65"); a template saved
  before wrote "CHF {{vermoegen}}" — the renderer drops that literal "CHF " (`LEGACY_CURRENCY`).
- **Dashboard**: never sums across currencies. `?currency=` picks the projects in one tax currency
  (default: the newest project's); the answer has `currency` + `currencies`; the page shows a
  currency select with a note when there are several. The project card uses its project's
  currency; "Kurse aktualisieren" fetches in the shown currency.
- **Packages** carry `project.taxCurrency` (zod default CHF for older ones); follow-up projects
  keep the source's currency.
- **Web**: `formatChf(value, currency?)` / `lkChf: currency` prefix the code ("EUR 1’234.56");
  table headers take `{{currency}}` (`result.fields.valueChf`, …). The workspace gets
  `[taxCurrency]`; `ProjectWorkspaceService.currency()` = the latest result's currency, else the
  project's. Create form + project detail: select (country default, CHF/EUR/USD/GBP, then the
  rest); changing it on the detail page asks first (`projects.detail.currency*`).

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
shared `lk-records-dialog`. ESTV year-end values reach the dashboard as the projects' applied
`estv` rows (F7.4a; same priority as in the calculation, only from the project owning that
year) — the deployment-wide `estv_*` tables are not read directly. Rates: a **user rate cache**
(`user_rate`, never `manual`/`estv`; unrelated to the deployment-wide `estv_rate`) filled
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
not done (latest snapshot + carried ones), notes, and the project's **wallets** (preselected;
linked in the same transaction via `ProjectBundle.walletIds`, carry-over kind `wallet` — the
wallets migration widens that CHECK; their derived files are made anew by `WalletDerivedFiles.sync`
after the write, files with origin `wallet:` are never offered or linked; manual balances stay with
their year); `GET|POST /projects/:id/take-over` (F4.4: files
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

**ESTV Kursliste, automatic (F7.4a)** — once per **deployment**, not per user: tables
`estv_kursliste` (PK year: the newest `THIRD.INIT.<n>` export downloaded — type, export date,
file hash, schema version, counts), `estv_rate` (year-end values: `crypto` / `currency` from
`currencyNote` + `yearend@taxValueCHF`, `fx` from `exchangeRateYearEnd@value`; CHF per unit, i.e.
divided by `denomination`) and `estv_check` (last check per year, outcome `updated|current|failed`

- error). Only the newest version per year is kept.

* **Client** (`integrations/rates/ictax/`, own implementation; the protocol as documented by the
  MIT project OpenSteuerAuszug): `GET /extern/api/authentication/session.json` → `data.csrfToken`
  (header `X-CSRF-TOKEN`) + the session cookies → `POST /extern/api/xml/xmls.json`
  `{from:0,size:100,sort:[],year}` → `GET /extern/api/download/<fileId>/<fileHash>/<fileName>` = a
  ZIP (`kursliste_<year>.xml` ≈ 410 MB for 2025, ISO-8859-1, plus `.idx` and the XSD). The ZIP is
  **streamed** to a temp dir (≤ 250 MB, 15 min), the XML entry is inflated out of it
  (`zip-entry.ts`, no ZIP64) and **SAX-parsed** with `saxes` by local name (namespaces
  `…/ictax/2.0.0/kursliste` and `2.2.0`; deleted entities and `undefined` values skipped) — the
  real 2025 list parses in ≈ 4 s with ≈ 40 MB heap (82 cryptos, 166 FX). Retries (3, backoff ×2)
  on network/timeout/429/5xx; errors are `EstvSourceError` with a code and a URL-free message.
  Crypto tickers are `securityAppendix` (`BTC`, `IOT` = IOTA), names `securityName`.
* **Selection** (`rates/domain/estv.ts`): `THIRD.INIT.*` only (never `DELTA`), highest numeric
  suffix (= schema, 220 = 2.2.0), newest `exportDate`; download only when the file hash differs
  and the export is not older (`isNewerExport`).
* **Sync** (`EstvSyncService`): one run at a time (a covered request joins it, others queue),
  progress `{phase: metadata|download|parse|store, bytes, totalBytes, entries}` for polling.
  `EstvScheduler`: 60 s after start (desktop: every start) and every 24 h — years = every stored
  year + last year; never in `NODE_ENV=test`. Gates: `ESTV_AUTO=false` or `RATES_ONLINE=false` →
  off (manual import stays); on demand also the user's F11.3 switch; desktop (`AUTH_MODE=local`)
  ticks only with the local user's switch on. `ESTV_BASE_URL` points at a fake server for live
  checks (`node scripts/dev/fake-ictax-server.mjs`, port 11436, `POST /bump` = newer version).
* **API**: `GET /api/rates/estv` (status: versions per year with label/counts, checks + errors,
  `running`, `lastCheckAt`, `online`), `POST /api/rates/estv/update {year?}` (202, starts in the
  background; 409 when gated), `POST /projects/:id/rates/estv/apply` (local data, works offline).
* **Projects**: `EstvProjectRatesService.apply` runs first in "Kurse aktualisieren" (and on
  "übernehmen"): assets = `assetsNeedingPrices` + stablecoin positions, matched by ticker, then
  `ESTV_SYMBOL_ALIASES` / `RATE_ALIASES`, then exact name; several entries of one ticker → the
  one whose name is the known coin name (CoinGecko id table / user ids), else **ambiguous: no
  value** (the UI asks for an override). Writes `estv` rates at 31.12. (price CHF + fx USD/EUR) with
  `project_rate.note` = `ESTV-Kursliste <Jahr>, Stand <dd.MM.yyyy>`; automatic rows that no longer
  match are removed. ESTV wins by the price priority (also USD/CHF at 31.12. over the ECB fixing);
  a new version changes values → the input hash → the snapshot is stale. `GET …/rates` has `estv`
  (`available`, `applied`, `outdated`). The note is not part of the input hash.
* Web: `shared/estv/estv.service.ts` (status, start, poll every 1.5 s while it runs, shown in the
  activity indicator with its phase/progress, toast per outcome); Einstellungen › Kurse shows the status table and the button;
  the project's Kurse tab the version in use, "Neuen Stand übernehmen", "ESTV-Kursliste
  aktualisieren" (download + apply) and ambiguous assets; the ESTV label replaces the source.

## Wallets (F6.1–F6.7)

A wallet = a **public** address (or a Bitcoin xpub/ypub/zpub) of one user with label, networks,
notes (`wallet`); projects include wallets (`project_wallet`). Web: **Wallets** in the main
navigation (`features/wallets`: list, `/app/wallets/new|:id` with form, network check, fetch, per
network status `lk-network-status`, tokens with spam verdict), the project tab **Wallets**
(`components/project-wallets`: include/remove, check, fetch, manual balances with a PDF receipt)
and **Einstellungen › Wallets & Netzwerke** (keys + URLs, "Testen" per service on the form's
unsaved values, the precise error: code, HTTP status, provider words).

- **F6.2 secrets** (`libs/engine/src/wallets/secrets.ts`, `detectSecret`): BIP-39 runs of ≥ 12
  English list words (bundled `@scure/bip39` word list), 64 hex (± `0x`), WIF, `x/y/z/t/u/vprv…`,
  Solana base58-64-byte keys and 64-byte JSON arrays — in address, label and notes, before anything
  else. 422 `{ code: 'secretRefused', kind }` — never the input, a word of it or its length; the web
  clears the fields and explains. `POST /api/wallets/inspect` classifies without storing.
- **Networks** (`libs/engine/src/wallets/networks.ts`): bitcoin; EVM ethereum (1), bsc (56),
  polygon (137), arbitrum (42161), optimism (10), base (8453); solana; cardano, polkadot (coverage
  `income`: rewards fetched, balance by hand); cosmos (`manual`). `classifyAddress` →
  `networksForAddress` = what F6.4 checks.
- **Adapters** (`integrations/chains/`, port `wallets/ports/chain-data.port.ts`
  `ChainDataPort` per family, `ChainDataSourcesPort` bound in `IntegrationsModule`; `ChainSources.fake()`
  with **`LK_CHAINS_FAKE=1`**, refused in production): `ChainHttpClient` = serial gate per provider,
  5-min cache of successful answers (keyed per secret hash), JSON with numbers as source text,
  errors → `ChainDataError(code, detail, status)` with keys **redacted**. Etherscan API V2
  (`txlist`/`txlistinternal`/`tokentx` paged by start block, activity = probes + nonce; "not on
  your plan" → `chainNotOnPlan`), Esplora (mempool.space default; xpub/ypub/zpub derived with
  `@scure/bip32` + `@scure/base`, gap limit 20 on receive + change — BIP84 test vectors in the
  spec), Solana JSON-RPC (Helius URL from the key, a custom URL or the public endpoint;
  signatures + `getTransaction jsonParsed`, SOL by pre/post balances, SPL by owner), Koios
  (rewards by spendable epoch), Subscan (rewards, `x-api-key`), Cosmos LCD (activity + balance).
  Limits: Etherscan 50 pages × 1000 per list, Solana 3000 tx, Bitcoin 400 addresses — beyond
  that the fetch says `truncated`.
- **Gate** (`wallets/application/chain-gate.ts`): only explicit actions (check, fetch, test),
  never in the calculation; F11.3 (the user's online switch and `RATES_ONLINE`) → 409 `offline`;
  user URLs pass the AI SSRF check; keys opened only for the call. Settings: Etherscan key stays
  in `user_settings` (saved through `UpdateSettingsCommand`), Helius/Subscan sealed in
  `chain_settings` with Esplora/Koios/LCD/Solana-RPC URLs (`GET|PUT /api/settings/wallets`,
  `POST …/test`).
- **Derived files** (the pipeline stays unchanged): `wallet_network_data` keeps the last fetch per
  network (normalised `ChainMovement[]`, decimal strings; a failed fetch keeps the old movements +
  the error). `WalletDerivedFiles.sync` writes per project `<label>.wallet-buchungen.csv`
  (`walletBookingRows`: Plattform = `walletPlatform(label, network)` = `<label> · <network>`, so a
  manual balance of one network is never a platform-wide statement over another; Konto = network, Referenz = tx hash, row = movement
  index; deposit/withdrawal/fee/income_staking/income_airdrop/spam, gas in Gebühr, failed tx →
  `fee`) and `<label>.wallet-bestaende.csv` (F6.5 manual balances = statement holdings for that
  wallet/network, Beleg = the PDF's name) with origin **`wallet:<walletId>`** (migration
  `20261008140000_wallets` widens the `project_file.origin` CHECK). Same bytes → same file; new
  bytes → added, the old one removed (F5.7). Closed projects are never touched; deleting a wallet
  used by a closed project → 409 `usedByClosedProject`. Synced on fetch, add/remove, label/network
  change, "kein Spam" and balance changes.
- **F6.6 spam** (`tokenVerdicts`): scam names ("Claim", URLs), zero-value only, address poisoning
  (look-alike of a recipient), unverified incoming-only, impersonated symbols; spam rows get asset
  `SPAM:<sym>` and kind `spam`; "kein Spam" per token in `wallet_token_override`.
- **F8.1 check** (`calculation/wallet-check.ts`): the input gets `wallets: WalletState[]`
  (`wallets/domain/wallet-states.ts`, also part of the input hash); red = used but not selected, or
  selected + used and neither fetched nor a manual balance; yellow = not checked on every network,
  fetch failed, income-only network without manual balance; grey = no wallets. ENGINE_VERSION 3.

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
- **Mail** (migration `20261008130000_mail`, new tables only): `mail_settings` (PK `user_id`;
  security/port CHECKs, password sealed `enc:v1:%`, hint ≤ 8), `mail_template` (PK
  `(user_id, language)`, language/length CHECKs), `mail_log` (status, `json_valid` array,
  `failed` needs an error) and `project_sent_state` (PK `project_id`; way CHECK, exports JSON
  array) — all cascade; `mail.persistence.integration.spec.ts` tests them.
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
- **Tax currency** (migration `20261008170000_tax_currency`): `project.tax_currency` (`ADD COLUMN`,
  default `'CHF'`, CHECK 3 upper-case letters); `project_rate` and `user_rate` **redefined** only
  to widen their `currency` CHECK to any 3-letter upper-case code — every other CHECK and index
  copied. `persistence`/`calculation`/`carryover` integration specs test them.
- **Hints** (migration `20261008120000_project_hint_state`): `project_hint_state` (PK
  `(project_id, hint_key)`, cascade with the project; CHECKs: status `done|ignored`, key 1–600
  chars, note ≤ 500); `hints.persistence.integration.spec.ts`.
- **ESTV** (migration `20261008100000_estv_kursliste`): `project_rate.note` (nullable, `ADD
COLUMN` — no redefinition), `estv_kursliste` (year 2000–2100, `THIRD.INIT.%`, counts),
  `estv_rate` (kind CHECK, positive plain decimal, cascade with its year), `estv_check` (outcome
  CHECK). Deployment-wide: no user/project column. Prisma writes `AUTOINCREMENT` for the `Int @id`
  year keys — harmless, the year is always given. `estv.persistence.integration.spec.ts`.
- **Dashboard / carry-over** (migration `20261008110000_dashboard_carryover`): `user_rate` (unique
  `(user, kind, asset, currency, date, source)`; source only `binance|coingecko|ecb`, decimal/date
  CHECKs; cascade with the user) and `project_carryover` (kind CHECK, `json_valid(data)`; cascade
  with the project; `source_project_id` is no FK — the source may be deleted later, its name stays).
  `carryover.persistence.integration.spec.ts` tests the transaction and the CHECKs.
- **Assistant / MCP** (migration `20261008180000_ai_chat_mcp`): see "Tool layer, AI assistant,
  MCP server".
- **Language** (migration `20261008190000_user_locale`, F11.2): `user_settings.locale` (nullable,
  CHECK `de-CH|en`) and `mail_template` **redefined** only to widen CHECKs — `number_format`
  `de-CH|en`, `date_format` four patterns, `mail_template.language` `de-CH|en`; every other column
  and CHECK copied. `mail.persistence.integration.spec.ts` tests them.
- **Setup / PIN** (migration `20261008150000_setup_pin`, new tables only): `setup_progress` (PK
  `user_id`; `steps` must be a JSON object, `current_step` CHECK) and `user_pin` (PK `user_id`;
  `pin_hash LIKE 'scrypt$%'`, counters ≥ 0, auto-lock 1–240) — both cascade with the user;
  `setup.persistence.integration.spec.ts`.
- **Notifications** (migration `20261008160000_notifications`, new table only): `notification`
  (unique `(user_id, topic)`, index `(user_id, occurred_at)`; CHECKs: kind, topic 1–300,
  `title_key LIKE 'notifications.%'`, params a JSON object ≤ 4000, action null or a JSON object;
  cascade with user and project); `notifications.persistence.integration.spec.ts`.
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
  `NODE_ENV=development|test`. In Scalar, paste `dev:anna@lazykoins.dev`. The app's dev sign-in
  appends the sign-in time (`dev:<email>#<epoch ms>`, same uid) — the PIN lock's "fresh sign-in"
  (`authTime`, F11.0p); a plain token has no sign-in time.
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
`PinLockGuard` runs right after it (F11.0p, see Setup wizard and PIN lock).
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
- **Page header** (user rule, 08.10.2026): `lk-page-header` is sticky and spans the full width of
  the scroll area (`.lk-scroll-content` is the inline-size container, so `100cqw` excludes the
  scrollbar). An element marked `lkPageHeaderBelow` goes under the title inside the sticky part —
  the project detail puts its tab bar there (`lk-project-workspace-tabs`). The workspace services
  are provided by the detail page (`provideProjectWorkspace()`) so header and tabs share them;
  the first tab "Allgemein" (data, facts, chart, carry-overs) is the page's own content, and
  `#file-<id>` without `?tab=` opens "Dateien".
- **Form rows** (user rule, 08.10.2026): fields side by side always line up — one-line labels
  (truncated, full text as `title`), inputs on the same line even when a label is long or a field
  shows an error, a usable minimum width per field. Use `lk-form-row` + `lk-field` (styles.css);
  existing grids of label + input columns get the same via a global rule.
- **Dialog layout** (user rule, 07.10.2026): three fixed regions — `<hlm-dialog-header>` at the top,
  `<div class="lk-dialog-body">` in the middle (the ONLY part that scrolls), `<hlm-dialog-footer>`
  with every action button across the full width at the bottom. All three are **direct children**
  of `<hlm-dialog-content>`; a footer inside an `@if` is fine as long as it stays a direct child.
  Styled globally in `styles.css`. The same goes for any other overlay with actions.
- Desktop first: the shell is a header with the navigation (`core/layout/app-shell`), no tab bar.
- **Every action that can take more than ~1 s goes through the `ActivityService`** (user rule,
  F11.20): `core/activity/activity.service.ts` (root, signals) shows it in the app-wide
  indicator (`lk-activity-indicator` in `app.html`, bottom right, above dialogs and toasts —
  the toaster moves up while it shows; `role="status"`, spinner `aria-hidden`, still with reduced
  motion). For an action: `actions.run(action, payload, { activity: { label, params?, progress? } })`
  — the runner's own toast ends it. Otherwise `activity.track(labelKey, promise | observable |
() => promise, { params, progress, success, error })`, where `success` may return a toast with
  an action ("Herunterladen", "Anzeigen") or `null`. Labels are i18n keys under `activity.*`.
  Server work that outlives a quick answer reports progress through a status endpoint polled
  only while the request runs (rate refresh: 1 s); everything else tracks the request itself.

### Data refresh (user rule, 08.10.2026: „Änderungen sollen alles updaten“)

**Every change refreshes every view that shows affected data — through ONE mechanism**,
`core/data/data-changes.ts`:

- `DataChanges` (root): `changed({ projectId?, scope? })` — `projectId` a string = that project,
  `null` = every project (a mapping or wallet feeds every project that uses it), absent = none;
  `scope` ∈ `projects | mappings | wallets | rates | settings | notifications` (a project change
  always bumps `projects` too). Readers: `projectVersion(id)`, `globalVersion(scope)`.
- **Emitted automatically** by `dataChangesInterceptor` (`core/data/data-changes.interceptor.ts`,
  innermost in `app.config.ts`): a **successful** POST/PUT/PATCH/DELETE to `/api/**` is mapped by
  `changeOf(method, url)` — an explicit table (`RULES`) plus a deny list of POSTs that only read
  (`READ_ONLY`: mapping/sample previews, inspections, AI proposals and payloads, settings/key
  tests, mail compose/preview, the chat, PIN, the dashboard's per-asset rate refresh). A GET never
  emits, so a refetch can never trigger another one. **A new mutating route needs its line in
  the table** (and in `data-changes.interceptor.spec.ts`). Explicit calls only where the URL cannot
  tell: `ChatService` after a confirmed proposal.
- **Consumed** with `reloadOn(version, [resources])` in the page services: `reload()` keeps the
  value on screen (no skeleton flash — a version read inside the request function would reset
  it), is a no-op for a resource without a request (a tab not shown) or one already loading, and
  ends with the injection context. Several changes in one tick = one refetch. Root list services
  (projects, mappings, wallets, notifications) have `follow()`, called in their page's constructor:
  reload on arrival + watch while on screen — nothing refetches in the background.
- Wired: workspace tabs (result, checks, corrections, rates, exports), files area + hints + project
  mappings (my mappings on `mappings`), wallets tab, send-to-advisor (log, F4.7), project page
  header (project, F4.7, carry-overs, `result/status`), dashboard page + project card, project
  list, mappings list + usage, wallets list + tokens, notifications page and the bell
  (`notifications` + `projects`). Forms are not reloaded under the user's typing (the project
  form resets only when its facts really changed; the mapping editor and wallet form are set from
  their own answers).
- **Stale**: `CalculationInputService.isStale` is the one rule (engine version or input hash —
  files, mapping versions, corrections, rates, wallets, currency, previous year); `GET
/projects/:id/result` (`stale`), `GET /projects/:id/result/status` (`{ calculatedAt, stale }`,
  cheap) and the list (`stale`) use it. The project page shows "Daten geändert – neu berechnen"
  with a button under its header; the list marks the figures "veraltet". No silent
  auto-recalculation (a correction still recalculates, as designed). The dashboard computes from
  the live input and is never stale. `calculation/application/staleness.spec.ts` covers every change.

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
- Every visible string is a key in `public/i18n/de-CH.json` (German/Swiss, du-form) **and**
  `public/i18n/en.json` (English, F11.2); `no-hardcoded-text` rejects literal text in templates
  and `core/i18n/i18n-keys.spec.ts` fails when a referenced key is missing in either file, when
  the two files differ in their key sets, or when a text's `{{placeholders}}` differ. Keys built
  at runtime (`projects.status.<status>`) are listed in that spec. **Adding a key = both files.**
- **Languages (F11.2)**: German (Switzerland) and English. The language lives on the user
  (`user_settings.locale`, `null` = not chosen yet → the browser's: `de*` → de-CH, else en) with
  the number format (`de-CH` 1’234.56 | `en` 1,234.56) and the date format (`dd.MM.yyyy`,
  `yyyy-MM-dd`, `dd/MM/yyyy`, `MM/dd/yyyy`); migration `20261008190000_user_locale`. On the
  desktop the same row is local, and the window also tells the main process (bridge
  `locale.set` → `desktop-config.json` `locale`) for its menus/dialogs
  (`apps/desktop/src/main/lib/messages.ts`, one dictionary per language). Web:
  `core/i18n/locales.ts` (`SUPPORTED_LOCALES`, browser default, last language in localStorage
  `lk.locale` for the login page), `LanguageService` (root; `use` / `apply(settings)` /
  `preview`: ngx-translate's language, `<html lang>`, the formats, the desktop) — the app shell
  applies the profile as soon as it loads. Profil › "Sprache und Format" and the wizard's first
  step use `lk-language-fields` (a new language brings its formats unless the user chose others,
  `withLanguage`); the profile saves it at once, the wizard with "Weiter". **Formatting**: never
  Angular's DatePipe/DecimalPipe (their locale is fixed at start) — `lkDate` (`'date' |
'dateTime' | 'dateTimeSeconds'`, optional `'UTC'`), `lkChf`, `lkQuantity`, `lkNumber` are
  impure pipes over the `displayFormat()` signal; code uses `formatDate` / `formatChf` /
  `formatRelative`. A `computed` that calls `translate.instant` reads `translate.currentLang()`
  so it re-translates on a switch.
- **API texts per language**: `common/i18n/locale.ts` (`Locale`, `localeOr`). The documents
  (statements PDF/Excel, internal report, mail draft) come from `exports/application/texts/`
  (`ExportTexts`, one file per locale; `exportKit(locale, format)` adds the formatters) — the
  German file is pinned byte for byte by `export-language.spec.ts` (snapshot). Country terms and
  form references stay in the country rules (`rulesInLanguage`, `translatedLabels.en` keeps the
  official German term in parentheses, F10.3). The mail template has a default per language
  (`DEFAULT_MAIL_TEMPLATES`, `mail_template.language`), compose and the template endpoints use
  the user's language (`?language=` overrides). The assistant's default prompt and fixed rules
  exist per language (`assistant-prompt.ts`); the prompt's context names the app language.
  The data export (F10.7) translates only its information columns — the standard format's own
  columns are a file format and stay German. Notification titles are keys rendered by the web.
  Tool titles have an English map (`tools/domain/tool-titles.ts`; Einstellungen › MCP gets
  `titles` per language, proposal cards the user's).
- **Proposal cards** carry **keys, not sentences**: a tool's `preview` returns `ToolText`
  (`{ key, params }`, `tools/domain/preview-texts.ts`: `previewText('chat.preview.…', …)` typed
  against `PREVIEW_TEXTS`, `enumText` for codes with existing texts such as `bookings.kind.*`)
  or a plain string for data (names, amounts, arguments); the web renders them
  (`core/assistant/proposal-text.ts`, re-rendered on a language switch). `preview-texts.spec.ts`
  checks every key + its placeholders in both message files and that no `summary:`/`label:`
  literal creeps back into `tools/definitions`. Old proposals (German strings) show as stored.
  Event rows (`Executed: …`, `Cancelled by the user: …`) are English lines for the model; the app
  renders `chat.event.<outcome>` from `data.outcome` + the proposal's title, and a failed card
  shows `chat.proposal.errors.<code>` — never the tool's English message. The chat's own answers
  (loop limit, "prepared") are `APP_ANSWERS[locale]` in `chat-engine.ts`.
- **API errors (decided 07.10.2026)**: the **code is the contract**; `message` stays English
  (logs, OpenAPI, API clients) and the app never shows it. Coded families keep their own mapping
  (`ai.errors.*`, `mail.errors.*`, `pin.errors.*`, `wallets.errors.*`, setup/key-check codes);
  everything else goes through `extractErrorDetail` → `core/api/api-error.ts`: a known code →
  `errors.api.<code>` (`projectClosed`, `noCalculation`, `offline`, `estvAutoOff`,
  `usedByClosedProject`, `alreadyDecided`, `duplicateFile`, `invalidCorrection`, …; package codes
  → `notifications.reason.*`), else the HTTP status → `errors.status.<name>`.
  `NotificationService.error(key, detail)` translates an `ErrorText`. API side: 409s carry a code
  (`common/http/api-errors.ts`: `conflict(code, message)`, `projectClosed()`) — a new
  user-facing error gets a code + both texts. Technical diagnostics stay raw on purpose: the AI
  error panel (provider message, cause, the gate's `detail`), `lk-smtp-error`, a wallet
  provider's words, mapping-spec validation issues (zod paths/messages of the JSON format).
- **Standard-format template** (`GET /api/standard-format/template.csv|xlsx?language=`, default
  the user's language; the web passes the app's): the engine's `templateContent(language)` —
  explanation sheet (`Explanation`), column descriptions, example notes and the labels follow the
  language; **column headers and the sheet names `Buchungen`/`Bestände` stay German** (the format,
  re-importable, same rule as the data export) and the English explanation says so. File names
  `lazy-koins-template-*.csv|xlsx` in English.
- **Notification params** are codes the web translates (`service` → `notifications.service.*`:
  `ai | coingecko | mail | chain`); a stored row's old name is shown as it is.
- **en.json stays English**: `core/i18n/en-language.spec.ts` fails on umlauts and common German
  words, and on an official term (Treuhänder, Kursliste, Wertschriftenverzeichnis, …) outside its
  "(…)" after the English words; exceptions in its `ALLOWED` list with the reason.
- **User data is not translated**: project names/notes, file names, the `Beleg` text of a derived
  statement CSV (`<pdf>, S. <n>` — content of a German-format file). The dev seed
  (`scripts/dev/seed.mjs`) therefore keeps its German sample projects ("Steuern 2025").
- **Adding a language** = one message file `public/i18n/<code>.json` + the code in
  `SUPPORTED_LOCALES` (web `core/i18n/locales.ts` with its formats in `LOCALE_FORMATS` and its
  Angular locale data, API `common/i18n/locale.ts`) + the server catalogue: `ExportTexts` file,
  default mail template + sample values, assistant prompt + rules, the country rules'
  `translatedLabels`, the desktop dictionary — every one is a `Record<Locale, …>`, so the
  compiler lists what is missing — and the migration's locale CHECKs.
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
  exports spec opens the generated workbook with ExcelJS and checks the formulas. The ICTax
  client runs against a local `node:http` fake with the recorded response shapes and synthetic
  ZIP/XML fixtures (`integrations/rates/ictax/testing/kursliste-fixtures.ts`, both namespaces,
  a ~5 MB file for streaming) — never the real API. The real
  Chromium print (`playwright-pdf.renderer.spec.ts`) skips itself when no browser is installed.
- **Integration** (`*.integration.spec.ts`, excluded from `pnpm test`): the Prisma adapters
  against a real SQLite file with the real migrations — owner listing, empty updates, cascade,
  CHECK constraints. `scripts/dev/with-test-db.mjs` points them at `tmp/lazykoins-test.db`
  (never your dev database) unless `DATABASE_URL` is already set.
- Setup / PIN: `pin/testing/pin-fixture.ts` (every PIN handler over port doubles + a
  `ManualClock`), `pin-lock.http.spec.ts` (a real Nest app with the guard on a port: 423 without
  token, `lockAll`, wrong PIN, one user's token never unlocks another); web: `PinLockService` +
  interceptor with `HttpTestingController` (BroadcastChannel stubbed out), `LockScreenService`
  with fake timers, `SetupPageService` + `setupGuard`; desktop: `lock-watch.spec.ts`.
- Dashboard / carry-over / packages: `bundleSetup()` (`carryover/testing/bundle-fixture.ts`) adds
  the bundle, carry-over, export and user-rate doubles to the calculation fixture; package specs
  build tampered / zip-slip ZIPs with fflate; the data-export spec re-uploads its own CSV.
- Tool layer / chat / MCP: `toolSetup()` (`tools/testing/tool-fixture.ts`) = the calculation
  fixture + the real service façades over a `HandlerBus` (a Command/QueryBus double dispatching to
  the handlers) and settings/mail/AI stubs carrying `PLANTED_SECRETS` (asserted absent from tool
  output). `chat-engine.spec.ts` drives the loop with a scripted `AiCompletionPort` (tool calls,
  proposal → confirm/cancel, loop limit, provider error); `mcp.spec.ts` runs the controller behind
  a real loopback listener with the SDK `Client` + `StreamableHTTPClientTransport` (PAT auth,
  revoked/expired, write switch, per-token limit); `ai-converse.spec.ts` checks both adapters'
  wire format with a fake `fetch`; the desktop's `lib/mcp.spec.ts` the endpoint file and the
  stdio forwarding. User scoping: `tool-scoping.spec.ts` (unit) and
  `tools.isolation.integration.spec.ts` (cross-user suite over the whole registry, see "User
  scoping guarantees"; it boots AppModule with `AUTH_MODE=dev`, `RATES_ONLINE=false`,
  `LK_CHAINS_FAKE=1` and the IP/account throttler storage stubbed — adding a tool means adding
  its entry to `CASES`).
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
- **Sample-file requests are multipart** (`mapping-samples/*`, `ai/mapping-sample*`): a file
  _and_ a spec in one stateless request. `FileInterceptor` (multer from
  `@nestjs/platform-express`, memory only, `SAMPLE_UPLOAD_LIMITS`); form fields arrive as
  strings (`@Type(() => Number)`, `consent` "true"/"false" via `@Transform`); there is no
  `@types/multer`, so the part is typed as `UploadedSample`. Multer decodes the part's file name
  as latin1 — the app sends the UTF-8 name as the `name` field. `HttpTestingController`
  matches a string URL against `urlWithParams`: match an upload with `?name=` by function.
- Angular's fetch backend (`withFetch()`) emits **no upload progress** events; the files area
  shows per-file state and the batch's progress instead.
- `hlmBtn` styles `button`/`a` only — a `<label hlmBtn>` renders unstyled; use a button that
  clicks a hidden `<input type="file">`.
- `HttpTestingController.match()` **removes** what it matches; jsdom's `File` has no `text()`.
- DatePipe formats like `'dd.MM.yyyy'` look like i18n keys; `i18n-keys.spec.ts` skips them. Any
  other quoted dotted literal (a storage key like `lk.locale`) must be a template literal.
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
- Several agents may share the Browser pane: pass `tabId` explicitly when driving it. A live check
  can also drive the dev server headless with `playwright-core` (already a dependency); a
  component host like `lk-lock-screen` has no box of its own — wait for `.lk-lock-screen`.
- A user with a PIN gets **423** from every data endpoint without the unlock token: scripts and
  Scalar calls against such an account need `x-lazykoins-unlock` (`POST /api/pin/unlock`), or use
  an account without a PIN. `pnpm private:load` does it with `LK_UNLOCK_PIN=<pin>` (sent to the
  API only, never printed). Deleting `user_pin` rows behind a running API leaves its per-user PIN
  cache stale — restart it.
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
- **Never `app.use(express.json())` in `bootstrap.ts`**: Nest skips its own global JSON parser
  when a middleware named `jsonParser` is already in the stack, and every route then gets an empty
  body (400s everywhere). A route-specific parser must be wrapped in a function with another name
  (`mcpBodyParser`, regression test in `bootstrap.spec.ts`).
- The MCP SDK is CommonJS-importable through its `./*` export (`@modelcontextprotocol/sdk/server/index.js`,
  `…/types.js`); it uses `zod/v4` = our zod 4. Its client validates `structuredContent` against a
  tool's `outputSchema` — an output schema that does not match the parsed output breaks the call.
