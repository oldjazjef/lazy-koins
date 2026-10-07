# lazy-koins on Coolify (one-time setup)

lazy-koins runs on the same Hostinger VPS and Coolify as surf-lend and hello-eme. The wildcard DNS
record `*.hello-eme.ch` already points every subdomain there, and Coolify issues the HTTPS
certificates.

| Address                        | What                | Updated on                         |
| ------------------------------ | ------------------- | ---------------------------------- |
| `lazy-koins.hello-eme.ch`      | web app, production | GitHub release `vX.Y.Z` + approval |
| `lazy-koins-test.hello-eme.ch` | web app, test       | every merge to `main` (after CI)   |

Each serves the app **and** the API: `/api` goes through the web container's nginx, so there is only
one domain per environment. Other domains work too — replace them everywhere below. No platform
console, no payments, no push notifications: just `api` + `web`. Time: about 20 minutes.

Every step says **📍 Where** to click. In Coolify the **left sidebar** is the main menu.

**Write down along the way** (you need them in step 8):

| Value                       | from step |
| --------------------------- | --------- |
| Firebase project id         | 1         |
| Firebase web app config     | 1         |
| UUID of the test resource   | 4a        |
| UUID of the production res. | 5         |
| Coolify API token           | 7         |

---

## 0. Already done for hello-eme

These steps of [hello-eme's SETUP.md](https://github.com/oldjazjef/hello-eme/blob/main/deploy/coolify/SETUP.md)
apply to the whole server and don't need repeating: **1** (DNS `@` + `*`), **2–3** (Coolify account and
`https://coolify.hello-eme.ch`), **4** (API access on), **5** (`docker login ghcr.io` on the server — the
`read:packages` token reads the lazy-koins images as well, they belong to the same account).

## 1. Firebase: project, web app, domains

**📍 Where:** [console.firebase.google.com](https://console.firebase.google.com) → your lazy-koins project

1. **Authentication** → **Sign-in method**: enable **Email/Password** and **Google**.
2. **Project settings** (gear) → **Your apps** → the **Web** app (create one if there is none) →
   note `apiKey`, `authDomain`, `projectId`, `appId`. They are public by design (they identify the
   project, they grant nothing) and go into the `LK_FIREBASE_*` variables (step 4b).
3. **Authentication** → tab **Settings** → **Authorized domains** → **Add domain**: add
   `lazy-koins-test.hello-eme.ch` and `lazy-koins.hello-eme.ch`. Without them sign-in fails with
   `auth/unauthorized-domain`.

The API only needs the project id (`FIREBASE_PROJECT_ID`) to verify sign-ins — no service account.

## 2. Build the first images

The images are built by GitHub Actions once the code is on `main`.

**📍 Where:** github.com → `oldjazjef/lazy-koins` → **Actions** → workflow **Deploy test**

Wait for the newest run to turn **green** (without a Coolify token it builds and pushes the images and
only skips the deployment). Before the first merge you can also start it by hand: **Run workflow** → pick
the branch.

## 3. Project and environments

**📍 Where:** left sidebar → **Projects** → **+ Add**

1. Name `lazy-koins` → **Continue**. Coolify creates the environment **production** by itself.
2. In the project → **+ New Environment** → name `test` → save.

## 4. Environment "test"

**a) Resource**

**📍 Where:** Projects → `lazy-koins` → environment **test** → **+ New** → section **Docker Based** →
**Docker Compose Empty**

1. Server/destination if asked: your server (localhost) → default destination.
2. Paste the whole content of [`deploy/coolify/lazykoins.yml`](lazykoins.yml) → **Save**.
3. The address bar now shows `…/service/<UUID>` → **write down the UUID of the test resource**.

**b) Environment variables**

**📍 Where:** in the resource → left submenu **Environment Variables**

| Variable                  | Value                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `IMAGE_TAG`               | `test`                                                                                                                               |
| `FIREBASE_PROJECT_ID`     | the Firebase project id from step 1 — the API refuses to start without it                                                            |
| `LK_FIREBASE_API_KEY`     | `apiKey` from step 1                                                                                                                 |
| `LK_FIREBASE_AUTH_DOMAIN` | `authDomain` from step 1                                                                                                             |
| `LK_FIREBASE_PROJECT_ID`  | `projectId` from step 1 (same as `FIREBASE_PROJECT_ID`)                                                                              |
| `LK_FIREBASE_APP_ID`      | `appId` from step 1                                                                                                                  |
| `SETTINGS_ENCRYPTION_KEY` | 64 random characters: `openssl rand -hex 32`. **Mark it as secret and keep it** — a new key makes the AI keys users saved unreadable |

Optional: `API_DOCS` = `true` serves the API reference at `/api/reference` (handy on test; off in
production by default). Variables starting with `SERVICE_` are generated by Coolify: **don't touch
them**.

**c) Domain**

**📍 Where:** in the resource → left submenu **General** → field **Domains for web**

`https://lazy-koins-test.hello-eme.ch` → **Save**. The field for **api** stays **empty**: the API is
only reachable through `/api` of the web domain.

**d) Start**

**📍 Where:** in the resource, top right → **Deploy**

After 1–2 minutes both services are green ("Running (healthy)"): `api` first (it applies the database
migrations on start), then `web`. Check `https://lazy-koins-test.hello-eme.ch/api/health`.

**e) Daily backup**

**📍 Where:** in the resource → left submenu **Scheduled Tasks** → **+ Add**

| Field              | Value                                                            |
| ------------------ | ---------------------------------------------------------------- |
| **Name**           | `backup`                                                         |
| **Command**        | `sqlite3 /data/lazykoins.db ".backup /data/lazykoins-backup.db"` |
| **Frequency**      | `0 3 * * *`                                                      |
| **Container name** | `api`                                                            |

→ **Save**. Keeps one consistent copy next to the database (a plain `cp` of a live database can be
broken); Hostinger's weekly server backups keep the history. The uploaded files are BLOBs inside
the database, so this one copy is everything.

## 5. Environment "production"

**📍 Where:** Projects → `lazy-koins` → environment **production** → **+ New** → **Docker Compose Empty**

Exactly like step 4, with these values:

- **4a**: paste the same file; **write down the UUID of the production resource**.
- **4b**: `IMAGE_TAG` = `production`; the same Firebase values (or those of a separate production
  project — then add its authorized domains too); its **own** `SETTINGS_ENCRYPTION_KEY`.
- **4c**: **Domains for web** = `https://lazy-koins.hello-eme.ch`.
- **4d Deploy**: fails for now, because the `:production` images only exist after the first release
  (step 9). That is expected.
- **4e**: same backup task.

## 6. One API container only

The database is a single SQLite file on the `lazykoins-data` volume. **Never scale the `api` service
beyond one container** and never point two resources at the same volume.

## 7. Coolify API token

Reuse hello-eme's `github-actions` token, or create a separate one:

**📍 Where:** left sidebar → **Keys & Tokens** → tab **API Tokens**

| Field           | Value                                                              |
| --------------- | ------------------------------------------------------------------ |
| **Description** | `github-actions-lazykoins`                                         |
| **Expiration**  | `1 year` (or `Never`)                                              |
| **Permissions** | **read**, **write**, **deploy** (not `root`, not `read:sensitive`) |

→ **Create** → copy the token right away (it is shown only once).

## 8. GitHub environments

**📍 Where:** github.com → `oldjazjef/lazy-koins` → **Settings** → left menu **Environments** →
**New environment**

In each environment: **Environment secrets → Add environment secret**, and
**Environment variables → Add environment variable**.

**`test`**

| Kind     | Name                     | Value                                  |
| -------- | ------------------------ | -------------------------------------- |
| Secret   | `COOLIFY_TOKEN`          | token from step 7                      |
| Variable | `COOLIFY_URL`            | `https://coolify.hello-eme.ch`         |
| Variable | `COOLIFY_RESOURCE_UUIDS` | UUID of the test resource              |
| Variable | `LAZYKOINS_SITE_URL`     | `https://lazy-koins-test.hello-eme.ch` |

**`production`**

| Kind     | Name                     | Value                             |
| -------- | ------------------------ | --------------------------------- |
| Secret   | `COOLIFY_TOKEN`          | token from step 7                 |
| Variable | `COOLIFY_URL`            | `https://coolify.hello-eme.ch`    |
| Variable | `COOLIFY_RESOURCE_UUIDS` | UUID of the production resource   |
| Variable | `LAZYKOINS_SITE_URL`     | `https://lazy-koins.hello-eme.ch` |

Also in `production`:

- **Deployment protection rules** → tick **Required reviewers** → add yourself → **Save protection rules**.
- **Deployment branches and tags** → **Selected branches and tags** → **Add deployment branch or tag rule** →
  ref type **Tag**, pattern `v*` → **Add rule**; once more → ref type **Branch**, pattern `main` → **Add rule**
  (for "Run workflow", which runs on `main`).

**Workflow permissions:**

**📍 Where:** repository → **Settings** → **Actions** → **General** → bottom: **Workflow permissions** →
**Read and write permissions** → **Save** (needed to push images, create releases and attach the
desktop installers).

The desktop signing secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`) are **not** needed yet — see [`../README.md`](../README.md#secrets-and-variables).

## 9. Done: how it runs from now on

- **Test**: merge to `main` → CI → images `sha-<commit>` → tagged `:test` → Coolify redeploys test →
  smoke test (`/api/health`, `/`, `/env.js`).
- **Production**: **Actions → Deploy production → Run workflow** → branch `main`, `bump` = `patch`
  (or `minor`/`major`, or an exact `version` like `v1.0.0`) → **Run workflow** → in the same run
  **Review deployments → Approve and deploy**. Production re-tags the images that ran on test; it never
  rebuilds. The desktop installers are built in the same run without waiting for the approval and
  attached to the release (see [`../README.md`](../README.md#desktop-builds)).
- **Logs / restart**: Coolify → Projects → `lazy-koins` → environment → resource → **Logs** on a service,
  or **Restart** at the top.

## When something goes wrong

| Problem                                                 | Fix                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Deploy: "pull access denied" / "unauthorized"           | Repeat hello-eme step 5b on the server (ghcr token expired or wrong).                                     |
| `api` restarts with `Invalid environment configuration` | The log names the variable. Usually `FIREBASE_PROJECT_ID` is empty (step 4b).                             |
| Page shows "404 page not found" / no certificate        | Domain missing `https://`, or set on `api` instead of `web`.                                              |
| `/api/...` returns 502                                  | `api` is not healthy yet — look at its logs.                                                              |
| Sign-in: `auth/unauthorized-domain`                     | Step 1.3.                                                                                                 |
| Sign-in: `auth/invalid-api-key` or nothing happens      | `LK_FIREBASE_*` empty or wrong (step 4b); check `https://<domain>/env.js`, then **Restart** the resource. |
| Saving an AI key fails                                  | `SETTINGS_ENCRYPTION_KEY` is empty (step 4b).                                                             |
| GitHub job "Deploy" fails with 401/403                  | Coolify API switched off, or the token lacks **deploy** (step 7).                                         |
| GitHub job "Deploy" fails with 404                      | `COOLIFY_RESOURCE_UUIDS` is not a resource UUID: copy it from `…/service/<UUID>` (step 4a/5).             |
| "deploy / production" fails after 2 s without a log     | The `main` branch rule is missing in the `production` environment (step 8).                               |
| "Deploy test" never starts after a merge                | It runs only when the **CI** workflow succeeded on `main` (`check` and `integration`).                    |
| "desktop" fails at "Attach installers to the release"   | Workflow permissions not **Read and write** (step 8), or the build wrote nothing to `dist/desktop/`.      |
