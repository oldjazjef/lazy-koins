import { plainToInstance, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * How a request is authenticated.
 *
 * - `firebase`: bearer tokens are Firebase Authentication ID tokens, verified with firebase-admin
 *   against `FIREBASE_PROJECT_ID`. The web app in production.
 * - `dev`: the token `dev:<email>` authenticates as that e-mail address, no Firebase involved. It
 *   exists so the API, Scalar and the app can be run end to end without a Firebase project, and
 *   so the seed user (scripts/dev/seed.mjs) can actually sign in. Refused at boot in production.
 * - `local`: the single-user desktop app (F1.2). No token at all — every request acts as one
 *   fixed local user (`LOCAL_USER_EMAIL`). Allowed in any NODE_ENV, but only together with
 *   `LOCAL_MODE=true`, and the API then listens on 127.0.0.1 only (see main.ts).
 */
export const AUTH_MODES = ['firebase', 'dev', 'local'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** The loopback address the API binds to in `AUTH_MODE=local`. */
export const LOCAL_HOST = '127.0.0.1';

/**
 * Every environment variable the API reads, in one place.
 *
 * Validation runs once at boot and throws — the process must not start half-configured. Read it
 * through `ConfigService<Env, true>` with `{ infer: true }`, never `process.env`.
 *
 * Non-string values carry an explicit `@Type(() => Number)` rather than relying on implicit
 * conversion, which needs `design:type` metadata that differs between the webpack build and the
 * SWC transform Vitest uses.
 */
export class Env {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  /** 3333, not 3000: port 3000 is commonly taken on development machines. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3333;

  /**
   * SQLite file: `file:./.data/lazykoins.db` (relative = against the working directory) or
   * `file:/data/lazykoins.db` in a container. Checked here so a leftover `postgres://` URL fails
   * at boot with a clear message rather than at the first query.
   */
  @IsString()
  @Matches(/^file:.+/, {
    message:
      'DATABASE_URL must be a SQLite file URL, e.g. file:./.data/lazykoins.db',
  })
  DATABASE_URL!: string;

  /** Comma-separated list of allowed browser origins. The default covers the dev server. */
  @IsString()
  CORS_ORIGINS = 'http://localhost:4200';

  /** Public base URL of this API, used as the OpenAPI server entry. */
  @IsUrl({ require_tld: false })
  PUBLIC_API_URL = 'http://localhost:3333';

  /**
   * Reverse proxies in front of the API. 0 locally. Behind Coolify it is 2 — Traefik (TLS), then
   * the web container's nginx, which forwards /api.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS = 0;

  // --- Authentication ---

  @IsIn(AUTH_MODES)
  AUTH_MODE: AuthMode = 'firebase';

  /** The Firebase project whose ID tokens are accepted. Required in `firebase` mode. */
  @ValidateIf((env: Env) => env.AUTH_MODE === 'firebase')
  @IsString()
  @MinLength(1, {
    message: 'FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase',
  })
  FIREBASE_PROJECT_ID = '';

  /**
   * The explicit opt-in for `AUTH_MODE=local`: `true` there, empty everywhere else. A second
   * variable on purpose — `local` trusts every request, so one mistyped AUTH_MODE must not be
   * enough to switch authentication off.
   */
  @IsIn(['', 'true'])
  LOCAL_MODE = '';

  /** The one user every request acts as in `AUTH_MODE=local`. */
  @IsEmail({ require_tld: false })
  LOCAL_USER_EMAIL = 'local@lazykoins.local';

  /**
   * The OpenAPI document and the Scalar reference (`/api/reference`). Empty = on everywhere but
   * `NODE_ENV=production`; `true`/`false` decide explicitly (e.g. `true` on a test server).
   */
  @IsIn(['', 'true', 'false'])
  API_DOCS = '';

  // --- Settings, rates, exports ---

  /**
   * Seals the API keys users store in their settings (F6.7) with AES-256-GCM (settings/
   * secret-box.ts). Any long random string; empty = storing keys is refused. Changing it makes
   * stored keys unreadable (users enter them again).
   */
  @ValidateIf((env: Env) => env.SETTINGS_ENCRYPTION_KEY !== '')
  @IsString()
  @MinLength(32, {
    message: 'SETTINGS_ENCRYPTION_KEY must be at least 32 characters',
  })
  SETTINGS_ENCRYPTION_KEY = '';

  /**
   * Chromium for the PDF exports (F10). Empty = the browser `playwright-core` installs
   * (`pnpm exec playwright-core install chromium`).
   */
  @IsString()
  PDF_CHROMIUM_PATH = '';

  /** Network for rate lookups (F11.3) at all; `false` keeps the API offline for every user. */
  @IsIn(['true', 'false'])
  RATES_ONLINE = 'true';
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(env, {
    skipMissingProperties: false,
    whitelist: false,
  });
  const messages = errors.map(
    (error) =>
      `  ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
  );

  // Allow-list, not deny-list: `dev` accepts unsigned tokens, so it needs an environment that
  // says outright it is not production.
  if (
    env.AUTH_MODE === 'dev' &&
    env.NODE_ENV !== NodeEnv.Development &&
    env.NODE_ENV !== NodeEnv.Test
  ) {
    messages.push(
      '  AUTH_MODE: `dev` accepts unsigned tokens — only with NODE_ENV=development or test',
    );
  }

  // `local` accepts every request: only with the explicit second switch, and never half-set.
  if (env.AUTH_MODE === 'local' && env.LOCAL_MODE !== 'true') {
    messages.push(
      '  AUTH_MODE: `local` needs LOCAL_MODE=true (it trusts every request — desktop app only)',
    );
  }
  if (env.AUTH_MODE !== 'local' && env.LOCAL_MODE === 'true') {
    messages.push('  LOCAL_MODE: `true` is only valid with AUTH_MODE=local');
  }

  if (messages.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${messages.join('\n')}`,
    );
  }

  return env;
}

/** Whether to serve the OpenAPI document and the API reference. */
export function apiDocsEnabled(
  env: Pick<Env, 'API_DOCS' | 'NODE_ENV'>,
): boolean {
  return env.API_DOCS === ''
    ? env.NODE_ENV !== NodeEnv.Production
    : env.API_DOCS === 'true';
}
