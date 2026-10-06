# lazy-koins

Turns exports from crypto exchanges and wallets into the tax documents for one tax year: **wealth
at 31.12.** and **income**, as a simple and a detailed statement (PDF + Excel). First country:
Switzerland, private assets. Requirements: **[ANFORDERUNGEN.md](ANFORDERUNGEN.md)** (cite them as
`F7.5`, `A1`, …); tax rules: `docs/FACHREGELN.md`.

Two ways to run it with the **same features** (F1): a multi-user **web app** and a single-user
**desktop app** (macOS + Windows, no login, data stays on the machine). A project moves between the
two as a package (F1.3).

> **Status (06.10.2026): files + mappings.** Nx monorepo with the NestJS API (`apps/api`: auth,
> users, **projects** = F4.1/F4.2/F4.5 basics, **files** = F5.1–F5.8 storage/upload/preview,
> **mappings** = declarative mapping specs), the Angular web app (`apps/web`: login, project list /
> form / detail with the files area and the project's mappings), the pure engine (`libs/engine`:
> money helpers, `Booking`/`Holding`, the **standard format "lazy-koins Buchungen v1"**, the
> **mapping spec** and its applier, F5.8 coverage hints, the golden test) and the infrastructure
> — ported from `surf-lend`. When in doubt about a convention, look at how surf-lend does it.
> **No per-platform importer code** (decided 06.10.2026): every platform is a mapping spec (JSON,
> stored per user). **Not built yet:** `apps/desktop` (Electron), AI-generated mappings (next
> phase), bookings persisted as rows, PDF text extraction, wallets, rates, checks, corrections,
> exports. Update this file whenever the code makes a section concrete or wrong.

## Stack

Same as surf-lend, minus mobile/Capacitor, Stripe, Firebase push, maps and analytics; plus
Electron for the desktop app (see Decisions — not scaffolded yet).

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

pnpm db:deploy     # prisma migrate deploy — applies pending migrations, safe on real data
pnpm db:migrate    # prisma migrate dev — AUTHORS a migration (read Database first)
pnpm db:seed       # anna@lazykoins.dev + two sample projects (local databases only)
pnpm db:studio     # prisma studio — browse the database

pnpm private:inspect   # structure of private/ (paths, sizes, headers, row counts) — never rows
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
apps/api/                   # NestJS API — the web app's backend AND (later) the desktop app's local server
  prisma/schema.prisma      #   the schema; prisma/migrations = the history (CHECKs hand-written)
  src/
    main.ts                 #   bootstrap: /api prefix, helmet, validation, CORS, OpenAPI; 127.0.0.1 in local mode
    config/env.ts           #   the validated environment — the process refuses to boot on a bad value
    common/throttling/      #   per-IP + per-account rate limits
    persistence/            #   the ONLY code that touches Prisma
      persistence.module.ts #     binds every repository port to its adapter (global)
      prisma/               #     PrismaService, sqlite-url, mappers, repositories/*.prisma.repository.ts
    integrations/           #   the ONLY code that touches firebase-admin; dev + local verifiers
    auth/                   #   AccessTokenGuard (global), PrincipalService, @Public, @CurrentUser
    users/                  #   GET /api/me
    projects/               #   the reference feature slice — copy its shape
    files/                  #   F5: upload (raw body), list, download, preview, assignment, templates
      application/          #     handlers, FileAnalysisService (engine runs), SourceFileReader (exceljs)
    mappings/               #   mapping specs: CRUD, JSON download, schema, project listing
    common/http/            #   RawBodyMiddleware (uploads), contentDisposition()
    openapi/                #   document + Scalar
apps/web/                   # Angular app
  public/env.js             #   runtime configuration (window.__LK_ENV__) — see Runtime configuration
  public/i18n/de-CH.json    #   messages
  src/styles.css            #   the ONLY place colours live (light + dark)
  src/app/
    core/                   #   actions/, api/, auth/, config/, i18n/, layout/, notifications/, theme/
    features/<feature>/     #   login, projects, files (components only: embedded in the project detail)
    shared/files/           #   saveBlob / fileNameFrom — authenticated downloads
    shared/                 #   components/<c>/index.ts, forms/zod-validator
libs/engine/                # PURE TypeScript (@lazykoins/engine), no Nest/Angular/Prisma/network/fs/clock
  src/money/                #   decimal.js helpers: parseDecimal (strings only), roundTo, format*
  src/bookings/booking.ts   #   Booking, Holding, BookingKind (the closed list of the standard format)
  src/importers/            #   importer.ts (Importer, SourceFile, ImportResult) + registry.ts + table.ts
    text/                   #     pure decoding: bytes→text (UTF-8/16, cp1252), CSV, numbers, timestamps
  src/standard/             #   standard format v1: German columns, zod row validation, template content
  src/mapping/              #   mapping spec (zod, JSON Schema export) + applyMapping + fingerprints
    fixtures/               #     SYNTHETIC exports + example mapping JSON (test data, not product code)
  src/coverage/             #   coverage per platform/account + F5.8 missing-file hints
  src/golden/golden.spec.ts #   A1 against private/golden.json — skips when absent
libs/ui/<component>/        # spartan helm components (GENERATED — vendored)
tools/eslint-rules/         # workspace lint rules (Prisma boundary, no hardcoded text/design values)
scripts/                    # lint budget, private-inspect, dev/ (test-db wrapper, seed, hooks), build/
private/                    # REAL tax data + golden.json — git-ignored, see Private data
```

Planned, not built: `apps/desktop/` (Electron shell: starts the API in-process, loads the web
build), `libs/engine/src/{ledger,valuation,rules/ch,checks}/`, `libs/exports/` (PDF + Excel, F10).

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

To support a new platform: write (or later: let the AI write) a mapping JSON, check it with the
preview (`POST …/files/:id/mapping-preview` with `spec`), save it. For a test, add a synthetic
fixture + mapping JSON under `libs/engine/src/mapping/fixtures/` (skill `add-importer`).

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
- **`local`** (the future desktop app, F1.2): **no token at all** — every request acts as one
  fixed user (`LOCAL_USER_EMAIL`, uid `local:owner`) via `LocalIdentityVerifier.ambient()`.
  Allowed in any `NODE_ENV`, but only with the explicit second switch **`LOCAL_MODE=true`**
  (and `LOCAL_MODE=true` is refused with any other mode), and `main.ts` then listens on
  **127.0.0.1 only**. Never set it on a server.

`AccessTokenGuard` (global) verifies the token through `IdentityTokenVerifierPort` (or takes the
ambient identity when none is sent); `PrincipalService` creates the user row on first sight.
`@Public()` opts a route out (health). No roles: "you may act on what you own", checked in
handlers.

## Runtime configuration (app)

`apps/web/public/env.js` → `window.__LK_ENV__`, read by `core/config/runtime-env.ts`. The web
container's `entrypoint.sh` rewrites it at start from `LK_*` variables, so one image serves every
environment.

| Key          | Dev (`public/env.js`)      | Container (`entrypoint.sh`)              |
| ------------ | -------------------------- | ---------------------------------------- |
| `apiBaseUrl` | empty — dev server proxies | `LK_API_BASE_URL`, empty = nginx proxies |
| `authMode`   | `dev`                      | `LK_AUTH_MODE`, default `firebase`       |
| `firebase.*` | empty                      | `LK_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, … |

Only `/api` URLs get the bearer token (`isApiRequest`), never the i18n files or another host.
There is no `GET /api/config` (surf-lend's console settings); env.js is the only source.

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
- Desktop first: the shell is a header with the navigation (`core/layout/app-shell`), no tab bar.

## UI, styling, i18n

- spartan components are generated, never hand-written: `npx nx g @spartan-ng/cli:ui
--name=<c> --no-interactive` (skill `add-ui-component`). `libs/ui/**` is vendored — don't edit
  or format it. `ls libs/ui/` for what exists (badge, button, card, dialog, input, label,
  separator, skeleton, sonner, table, textarea, utils). Selects are native `<select hlmInput>`,
  as in surf-lend.
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

- **Unit**: pure domain functions, handlers against **port doubles**, the module graph
  (`app.module.spec.ts` compiles every provider), page services with `HttpTestingController`,
  the engine (money, text decoding, standard format, mapping specs applied to the synthetic
  Kraken/Binance/Bitfinex/Revolut fixtures, coverage). `files.handlers.spec.ts` runs the real
  engine + exceljs against in-memory ports.
- **Integration** (`*.integration.spec.ts`, excluded from `pnpm test`): the Prisma adapters
  against a real SQLite file with the real migrations — owner listing, empty updates, cascade,
  CHECK constraints. `scripts/dev/with-test-db.mjs` points them at `tmp/lazykoins-test.db`
  (never your dev database) unless `DATABASE_URL` is already set.
- **Golden** (`libs/engine/src/golden/golden.spec.ts`, A1): part of `pnpm test`, `describe.skipIf`
  `private/golden.json` does not exist (CI, other machines). Today it only checks existence.
- `libs/engine` has a `typecheck` target (Vitest's esbuild does not type-check); `pnpm check`
  runs it with the builds.
- Every bug fix gets a regression test.

## CI

`.github/workflows/ci.yml` on push to `main` and on pull requests: `check` (= `pnpm ci:verify`)
and `integration` (`pnpm ci:integration`, no database service needed). **The gate lives in
`package.json`** — add checks to `ci:verify`, never to the YAML alone.

`.eslint-budget.json` records warning ceilings (all 0); they may only go down. `libs/ui` is not in
the budget (vendored); its one noisy rule is switched off in `libs/ui/utils/eslint.config.mjs`.

## Deployment

- `apps/api/Dockerfile` — webpack bundle + pruned production install
  (`scripts/build/complete-api-package-json.mjs` adds what webpack cannot see); the container
  runs `prisma migrate deploy && node main.js`. `GET /api/health` is public. **Mount a volume at
  `/data`** (the database file) and run exactly one replica.
- `apps/web/Dockerfile` — the web build behind nginx, `/api` proxied to `LK_API_UPSTREAM`
  (uploads up to 50 MB), `env.js` written from `LK_*` at start.
- The Coolify pipeline (ghcr images, test → production, like surf-lend's `_images.yml` /
  `deploy-*.yml`) is not set up yet.

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

## Open decisions — ask, don't decide

- **OneDrive / Google Drive** connection for the web app (F3.2): API approach and folder sync.
- **Desktop packaging**: code signing / notarisation (Apple developer account, Windows
  certificate) and auto-update.
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
- `sqlite-url.spec.ts` compares against `path.resolve(...)`: surf-lend's copy hard-coded POSIX
  paths and only passed on Linux.
