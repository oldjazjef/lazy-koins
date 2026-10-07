# Deployment

lazy-koins' web app and API run on the Hostinger VPS with **Coolify** (Traefik + Let's Encrypt), next
to surf-lend and hello-eme. Two environments share the same images:

| Environment    | Deployed when                                 | Address                        |
| -------------- | --------------------------------------------- | ------------------------------ |
| **test**       | every merge to `main` (after CI is green)     | `lazy-koins-test.hello-eme.ch` |
| **production** | a GitHub **release** `vX.Y.Z` (see Releasing) | `lazy-koins.hello-eme.ch`      |

```
PR ──► CI (pnpm ci:verify, pnpm ci:integration)
main ──► CI ──► Deploy test: build images (sha-<commit>) ──► tag :test ──► Coolify redeploys test ──► smoke test
release vX.Y.Z ──► Deploy production ─┬─► approval ──► tag same images :production + :vX.Y.Z ──► Coolify redeploys production ──► smoke test
                                      └─► desktop builds (Windows .exe, macOS .dmg) ──► attached to the release
```

Production never rebuilds: it runs exactly the images that were deployed to test for that commit.

**First-time setup (Coolify, Firebase, GitHub): [`coolify/SETUP.md`](coolify/SETUP.md)** (step by step).

## Images

Built from the repo root in GitHub Actions (`.github/workflows/_images.yml`) and pushed to GitHub
Container Registry (private):

| Image                           | Dockerfile            | Port | Health        |
| ------------------------------- | --------------------- | ---- | ------------- |
| `ghcr.io/<owner>/lazykoins-api` | `apps/api/Dockerfile` | 3333 | `/api/health` |
| `ghcr.io/<owner>/lazykoins-web` | `apps/web/Dockerfile` | 80   | `/`           |

Tags: `sha-<commit>` (immutable), `test`, `production`, `vX.Y.Z`.

Version: `scripts/build/version.mjs` at build time (`LK_VERSION`/`LK_COMMIT` build args — the
build context has no `.git`) → `GET /api/version`, `GET /api/health` and the labels
`org.opencontainers.image.version` (`X.Y.Z+<commit>`) / `.revision`. Images are built once for
test and promoted unchanged, so they carry the newest tag **at build time**; the commit identifies
them. The desktop installers get the release tag itself (`LK_VERSION` in `_desktop.yml`).

## Coolify resource

One **Docker Compose Empty** resource per environment, pasted from
[`coolify/lazykoins.yml`](coolify/lazykoins.yml):

- `IMAGE_TAG` (`test` | `production`) selects the moving tag; `pull_policy: always` makes a redeploy
  fetch the image the pipeline just tagged.
- Only `web` gets a domain; `api` none. Its nginx proxies `/api` to `api:3333` (uploads up to
  50 MB), so the app shares one origin with the API and the API trusts **two** proxy hops
  (`TRUST_PROXY_HOPS=2`: Traefik + nginx).
- `api` keeps the **SQLite database on its `lazykoins-data` volume** (`/data/lazykoins.db` — the
  uploaded files are BLOBs in it, so this one file is everything) and runs `prisma migrate deploy`
  on every start. **Exactly one `api` container per database** — never scale it.
- `AUTH_MODE=firebase` is fixed in the file; the API refuses `dev` with `NODE_ENV=production`, and
  `local` (the desktop app's mode) must never run on a server.
- `SETTINGS_ENCRYPTION_KEY` (a Coolify **secret**) encrypts the AI provider keys users save; keep
  it, a new key makes the saved keys unreadable.
- Backups: Scheduled Task `sqlite3 /data/lazykoins.db ".backup /data/lazykoins-backup.db"` in
  `api`, plus Hostinger's weekly server backups.

## Deploy step

`.github/workflows/_deploy.yml` re-tags the images, then runs [`deploy.sh`](deploy.sh): it calls the
Coolify API (`POST /api/v1/deploy?uuid=…`), waits for the deployment and fails the job if it fails.
[`smoke-test.sh`](smoke-test.sh) then checks `/api/health`, `/` and `/env.js` (only when
`LAZYKOINS_SITE_URL` and `COOLIFY_TOKEN` are set). **Not configured yet** — `COOLIFY_TOKEN`,
`COOLIFY_URL` or `COOLIFY_RESOURCE_UUIDS` missing in the environment: the images are still built
and tagged, the deploy and smoke test are skipped with a notice (and a line in the run summary)
naming what is missing, and the run stays green.

## Secrets and variables

Names only — values never go into the repository.

**Per GitHub Environment** (`test`, `production`; GitHub → Settings → Environments → `<env>`):

| Kind     | Name                     | What                                                                                                    |
| -------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Variable | `COOLIFY_URL`            | the Coolify dashboard, e.g. `https://coolify.hello-eme.ch`                                              |
| Variable | `COOLIFY_RESOURCE_UUIDS` | UUID of that environment's Coolify resource (`…/service/<UUID>`)                                        |
| Variable | `LAZYKOINS_SITE_URL`     | the environment's public address, e.g. `https://lazy-koins.hello-eme.ch` (smoke test, environment link) |
| Secret   | `COOLIFY_TOKEN`          | Coolify API token with the _deploy_ permission                                                          |

**Repository secrets for desktop signing — reserved, not used yet** (GitHub → Settings → Secrets and
variables → Actions). They are only named, commented out, in `.github/workflows/_desktop.yml`:

| Name                          | What                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `CSC_LINK`                    | code-signing certificate (Windows `.pfx` / macOS `.p12`) |
| `CSC_KEY_PASSWORD`            | its password                                             |
| `APPLE_ID`                    | Apple ID of the developer account (macOS notarisation)   |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password of that Apple ID                   |
| `APPLE_TEAM_ID`               | Apple developer team id                                  |

`GITHUB_TOKEN` is provided by Actions (images, releases); nothing to set.

**Coolify** (resource → Environment Variables, per environment):

| Name                                                                                             | What                                                                                   |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `IMAGE_TAG`                                                                                      | `test` or `production`                                                                 |
| `FIREBASE_PROJECT_ID`                                                                            | Firebase project whose ID tokens the API accepts (required)                            |
| `LK_FIREBASE_API_KEY`, `LK_FIREBASE_AUTH_DOMAIN`, `LK_FIREBASE_PROJECT_ID`, `LK_FIREBASE_APP_ID` | Firebase web app config for the app's `env.js` (public by design)                      |
| `LK_UMAMI_URL`, `LK_UMAMI_WEBSITE_ID`                                                            | optional: Umami statistics (shared instance, one website per environment); empty = off |
| `SETTINGS_ENCRYPTION_KEY`                                                                        | **secret**: encrypts saved AI provider keys (`openssl rand -hex 32`)                   |
| `API_DOCS`                                                                                       | optional: `true` serves the API reference at `/api/reference` (e.g. test)              |

Variables starting with `SERVICE_` are generated by Coolify.

## Run it locally with Docker (without Coolify)

```bash
docker build -f apps/api/Dockerfile -t ghcr.io/oldjazjef/lazykoins-api:local .
docker build -f apps/web/Dockerfile -t ghcr.io/oldjazjef/lazykoins-web:local .
IMAGE_TAG=local SERVICE_URL_WEB=http://localhost:8080 FIREBASE_PROJECT_ID=<your-firebase-project> \
  docker compose -f deploy/coolify/lazykoins.yml up
```

(Publish `web`'s port 80 with an override file or `docker compose run --service-ports` to open it.
Signing in needs the `LK_FIREBASE_*` values too; for a quick look without Firebase use
`pnpm start:full` instead — dev auth.)

## Releasing

**Actions → Deploy production → Run workflow** (branch `main`; works in GitHub Mobile too). It picks the
next version from the newest `vX.Y.Z` tag (`patch` by default, or `minor` / `major`, or an exact
`version`), checks that "Deploy test" succeeded for the newest commit of `main`, creates the release with
generated notes and deploys it after approval, all in one run.

Publishing a release by hand still works (tag `vX.Y.Z` on a commit already on test):

```bash
gh release create v1.0.0 --target <commit> --generate-notes
```

Either way the `release` job appends a German/English install note for the desktop app to the release
notes (once; marker `<!-- lazykoins-desktop-notes -->`).

### Desktop builds

`.github/workflows/_desktop.yml` runs **in the same production workflow, right after the `release`
job** — it does **not** wait for the production approval. (It cannot be a separate `on: release`
workflow: a release created with `GITHUB_TOKEN` does not trigger other workflows.) On
`windows-latest` and `macos-latest` it runs `pnpm build:desktop` with `LK_VERSION` = the tag
without `v`, and attaches to the release:

| Platform              | Files                            |
| --------------------- | -------------------------------- |
| Windows               | `lazy-koins-Setup-<version>.exe` |
| macOS (Apple silicon) | `lazy-koins-<version>-arm64.dmg` |
| macOS (Intel)         | `lazy-koins-<version>-x64.dmg`   |

The same files (plus the `.blockmap`s) are kept as a workflow artifact for 7 days. There is no
auto-update yet, so electron-builder writes no `latest*.yml`; the upload step attaches them
automatically once a `publish` provider is configured (`apps/desktop/electron-builder.config.cjs`).
How the app is built and packaged: CLAUDE.md, section Desktop.

**Re-run for an existing release** (a build failed, or the installers need rebuilding): **Actions →
Desktop builds → Run workflow** → `tag` = e.g. `v1.2.3`. It checks out that tag and replaces the
attached files (`--clobber`).

**Unsigned for now** — users must confirm the first start once (the release note says so):

- **Windows (SmartScreen)**: "Windows protected your PC" → **More info** → **Run anyway** (German:
  «Weitere Informationen» → «Trotzdem ausführen»).
- **macOS (Gatekeeper)**: right-click the app in Applications → **Open** → **Open**, or
  `xattr -dr com.apple.quarantine "/Applications/lazy-koins.app"`.

Signing and notarisation are an open decision; the secrets they will need are listed under
[Secrets and variables](#secrets-and-variables).
