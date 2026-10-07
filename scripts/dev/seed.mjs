#!/usr/bin/env node
/**
 * Fills the development database with one user and two sample projects — synthetic data only
 * (CLAUDE.md, Private data: nothing from private/ ever goes into a fixture or a seed).
 *
 * The user signs in with `AUTH_MODE=dev`: their identity uid is `dev:<email>`, which is exactly
 * what DevIdentityTokenVerifier produces for the bearer token `dev:<email>` — so in the app's dev
 * login (or in Scalar) `anna@lazykoins.dev` is Anna.
 *
 * Idempotent: the user is matched on their uid, and a user who already has projects gets none
 * added. Run `pnpm db:deploy` first. Refuses to run with NODE_ENV=production.
 *
 * F11.2: the project names and notes stay German on purpose. They are user data (what Anna typed),
 * not app text — the app never translates what a user entered, so an English UI shows them as
 * they are, exactly like a real user's projects. Anna has no language set (`locale` NULL): the app
 * follows the browser until she picks one in Profil › Sprache und Format.
 *
 * Usage: pnpm db:seed   (reads DATABASE_URL from the environment or apps/api/.env)
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';
import { config as loadEnv } from 'dotenv';

loadEnv({
  path: ['apps/api/.env.local', 'apps/api/.env', '.env'],
  quiet: true,
});

const url = process.env.DATABASE_URL;
if (!url?.startsWith('file:')) {
  console.error(
    'seed: DATABASE_URL must be a file: URL (copy apps/api/.env.example to apps/api/.env).',
  );
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('seed: refusing to seed with NODE_ENV=production.');
  process.exit(1);
}
// Same rule as apps/api/src/persistence/prisma/sqlite-url.ts: relative = against the cwd.
const file = path.resolve(url.slice('file:'.length).split('?')[0]);

const ANNA = { email: 'anna@lazykoins.dev', name: 'Anna Muster' };

const projects = [
  {
    name: 'Steuern 2025',
    taxYear: 2025,
    canton: 'ZH',
    status: 'in_progress',
    notes: 'Beispielprojekt — Kontoauszüge noch hochladen.',
  },
  {
    name: 'Steuern 2024',
    taxYear: 2024,
    canton: 'ZH',
    status: 'closed',
    notes: 'Beispielprojekt — eingereicht.',
  },
];

const db = new Database(file, { fileMustExist: true });
db.pragma('foreign_keys = ON');
// Prisma stores DateTime in SQLite as ISO text with an explicit `+00:00` offset. Write exactly that
// shape: comparisons and CHECKs work on these strings, so mixed formats would compare wrongly.
const iso = (date) => date.toISOString().replace('Z', '+00:00');
const now = iso(new Date());

const seed = db.transaction(() => {
  const userId = db
    .prepare(
      `INSERT INTO "user" (id, identity_uid, email, display_name, sign_in_provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'dev', ?, ?)
       ON CONFLICT (identity_uid) DO UPDATE SET email = excluded.email
       RETURNING id`,
    )
    .get(randomUUID(), `dev:${ANNA.email}`, ANNA.email, ANNA.name, now, now).id;

  const existing = db
    .prepare('SELECT count(*) AS n FROM project WHERE owner_id = ?')
    .get(userId).n;
  if (existing > 0) return 0;

  const insert = db.prepare(
    `INSERT INTO project (id, owner_id, name, tax_year, country, canton, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'CH', ?, ?, ?, ?, ?)`,
  );
  for (const project of projects) {
    insert.run(
      randomUUID(),
      userId,
      project.name,
      project.taxYear,
      project.canton,
      project.status,
      project.notes,
      now,
      now,
    );
  }
  return projects.length;
});

const created = seed();
db.close();
console.log(
  `seed: ${ANNA.email} ready, ${created} project(s) added (sign in with dev:${ANNA.email}).`,
);
