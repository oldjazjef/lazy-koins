# lazy-koins

Turns exports from crypto exchanges and wallets into the tax documents for one tax year: **wealth
at 31.12.** and **income**, as a simple and a detailed statement (PDF + Excel). First country:
Switzerland, private assets. Requirements: **[ANFORDERUNGEN.md](ANFORDERUNGEN.md)** (cite them as
`F7.5`, `A1`, …); tax rules: `docs/FACHREGELN.md`.

Two ways to run it with the **same features** (F1): a multi-user **web app** and a single-user
**desktop app** (macOS + Windows, no login, data stays on the machine). A project moves between the
two as a package (F1.3).

> **Status (06.10.2026): not scaffolded yet.** This file fixes the stack and the rules before the
> first line of code. It follows `surf-lend` (itself on the `etx-working-time-manager` stack) —
> when in doubt about a convention, look at how surf-lend does it. Update this file whenever the
> code makes a section concrete or wrong.

## Stack

Same as surf-lend, minus mobile/Capacitor, Stripe and Firebase push; plus Electron for the
desktop app (see Decisions).

### Shared

|                 |                                                                       |
| --------------- | --------------------------------------------------------------------- |
| Node            | **22.x**, pinned via Volta in `package.json`                          |
| Package manager | **pnpm**, pinned via `packageManager` — do not use npm                |
| Nx              | exact version; `@nx/devkit` pinned to match in `pnpm-workspace.yaml`  |
| TypeScript      | 6.x                                                                   |
| Tests           | **Vitest** everywhere                                                 |
| Numbers         | **decimal.js** for every quantity, price and CHF amount — see Numbers |

### App (`apps/web`)

|         |                                                                                   |
| ------- | --------------------------------------------------------------------------------- |
| Angular | 22, **standalone + zoneless**, esbuild (`@angular/build`)                         |
| UI      | **spartan.ng** — `@spartan-ng/brain` + generated "helm" components in `libs/ui`   |
| Styling | **Tailwind CSS v4** (CSS-first, `.postcssrc.json`) + tokens in `src/styles.css`   |
| Forms   | Typed reactive forms, validated with **Zod** (messages are i18n keys)             |
| Data    | `httpResource` for reads, the **ActionRunner** for mutations                      |
| i18n    | **ngx-translate**, runtime JSON — `public/i18n/de-CH.json` (German/Swiss first)   |

### API (`apps/api`)

|          |                                                                                    |
| -------- | ---------------------------------------------------------------------------------- |
| NestJS   | 11, Express adapter                                                                |
| Database | **SQLite** — one file (`DATABASE_URL=file:…`), also what the desktop app uses      |
| ORM      | **Prisma 7** + `@prisma/adapter-better-sqlite3`, migration history, no `db push`   |
| CQRS     | `@nestjs/cqrs` — one handler per operation, events for side effects                |
| OpenAPI  | `@nestjs/swagger` + **Scalar**                                                     |
| Validate | DTOs with `class-validator` + `class-transformer`                                  |
| Build    | webpack via `@nx/webpack`; Vitest with `unplugin-swc`                              |

Frontend rules: no `zone.js`, no NgModules, no Material. `input()`/`output()`/`signal()` and
`inject()` — frontend only; Nest uses constructor injection.

## Planned layout

```
apps/api/                 # NestJS API — the web app's backend AND the desktop app's local server
apps/web/                 # Angular app (served by the API in the desktop build)
apps/desktop/             # Electron shell: starts the API in-process, loads the web build
libs/engine/              # PURE TypeScript, no Nest/Angular/Prisma/network:
  importers/<platform>/   #   detect + parse one export type -> Booking[] (with file + row)
  ledger/                 #   transfers matching, balances per account/asset/date
  valuation/              #   rates -> CHF, from a rate table handed in
  rules/ch/               #   country rules (F7.7): income categories, Steuerwert, labels
  checks/                 #   the checks of F8.1 -> traffic lights + open items
libs/exports/             # PDF + Excel statements (F10) from an engine result
libs/ui/<component>/      # spartan helm components (GENERATED — vendored)
tools/eslint-rules/       # workspace lint rules
private/                  # REAL tax data + golden.json — git-ignored, see Private data
```

The engine is a library so the API, the desktop app and the tests run **the same calculation**.

## Rules that come from the requirements

- **Numbers.** Crypto quantities have up to 18 decimals; JS `number` loses them. Every quantity,
  rate and CHF amount is a `Decimal` in code and a **decimal string (TEXT)** in the database and
  the API. Never `parseFloat`, never `x * rate` on numbers. Round only when presenting or
  exporting (A1 compares to ±0.05 CHF; the Kraken balance must match **exactly**).
- **Original files are immutable** (F5.3). Store them content-addressed by **SHA-256**: that is
  also duplicate detection (F5.4), sharing a file between projects without a copy (F4.4) and the
  reference count that decides when it is really deleted (F5.7).
- **Traceability** (F7.5): every `Booking` carries `sourceFileId` + `row` (or page for PDFs); every
  result figure keeps the ids of the bookings it was computed from. Never aggregate them away.
- **Determinism** (F7.6): the engine is a pure function of (bookings, corrections, rate table,
  country rules). No `Date.now()`, no randomness, no network inside it; rates are fetched _before_
  and stored per project with their source (F7.4). Sort explicitly — never rely on input order.
- **Corrections are data, not edits** (F9.4): they are applied on top of the imported bookings,
  each with reason, date, before/after, and can be undone. Imported bookings are never changed.
- **Country rules behind an interface** (F7.7); only `ch` exists. Labels and form references in
  exports come from the rules (F10.3).
- **Seed phrases and private keys** (F6.2) are detected and refused before anything is stored or
  logged — not even in an error message.
- **No tax advice**: every export carries the "keine Steuerberatung" note (F10.4).
- **Network is optional** (F11.3): with rate lookups off, everything still works from stored or
  manually entered rates.

## Private data

`private/` holds the user's **real** exports and `private/golden.json` (the expected values for
A1). It is git-ignored and must stay that way.

- **Claude reads structure only** (decided 06.10.2026): file names, column headers, row counts and
  periods — through a script that prints exactly that (planned: `pnpm private:inspect`), never the
  rows. Don't open files under `private/` with any tool (a `Read(./private/**)` deny in
  `.claude/settings.json` is still to be added by the user). Results against real data come from the golden test, which reports
  "matches" or "off by X CHF in <position>" — not the underlying rows.
- Never commit it, and never copy values, addresses, amounts or file excerpts from it into
  fixtures, tests, logs, commit messages, PRs or issues. Fixtures are synthetic.
- The golden test reads `private/` at run time and **skips** when it is absent (CI, other
  machines).
- Two guards: `.gitignore`, and `.githooks/pre-commit`, which refuses any staged path under
  `private/` (also after `git add -f`). Git only runs it with `git config core.hooksPath .githooks`
  — set it in every fresh clone (the scaffold's `prepare` script will do it). Never `--no-verify`.

## Decisions (06.10.2026)

- **Desktop = Electron** (`apps/desktop`): the main process starts the Nest API in-process on
  `127.0.0.1` with its own SQLite file in the chosen storage folder (F3.1) and loads the Angular
  build. No login: the API runs in a single-user mode. Same engine, same results as the web.
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
- **Exports = ExcelJS + Chromium PDF**: Excel with real formulas, named cells and styles (ExcelJS);
  PDF from HTML/CSS templates printed by Chromium (Electron's `printToPDF` on the desktop,
  Playwright in the API container).

## Secrets

- Never commit `.env` files, keys, service-account JSON or passwords (`.gitignore` covers the usual
  names; only `.env.example` with placeholders is committed). CI credentials live in GitHub →
  Settings → Secrets and variables → Actions; runtime secrets in Coolify.
- If a secret was ever committed: **revoke and rotate it first** — deleting the file does not
  remove it from history. Scrubbing history (`git filter-repo`) comes after, if at all.
- Security reports go through GitHub private vulnerability reporting ([SECURITY.md](SECURITY.md));
  `.github/CODEOWNERS` requires the owner's review.

## Open decisions — ask, don't decide

- **OneDrive / Google Drive** connection for the web app (F3.2): API approach and folder sync.
- **Desktop packaging**: code signing / notarisation (Apple developer account, Windows
  certificate) and auto-update.
- **Frontend API types**: hand-mirrored vs. generated from OpenAPI (same open point as surf-lend).

## Conventions carried over from surf-lend

- Persistence: Controller → Service façade → Command/QueryBus → Handler → Repository **Port**
  (abstract class) → Prisma adapter. Nothing outside `src/persistence/` imports Prisma.
- App features: `features/<feature>/<feature>.routes.ts` + `pages/<page>/{.ts,.html,.service.ts,.spec.ts}`,
  one page service per page; selector prefix **`lk`**.
- Every visible string is an i18n key; colours only in `styles.css` (light + dark).
- **The gate lives in `package.json`** (`pnpm check` = lint + format + test + build); CI only
  calls it. Every bug fix gets a regression test.
- The Nx daemon is disabled (`useDaemonProcess: false`) — its cold start costs minutes on Windows.
