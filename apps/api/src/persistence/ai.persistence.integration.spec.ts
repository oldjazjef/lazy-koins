import { createHash, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { NOT_ANALYSED } from '../files/domain/project-file';
import { toSqliteTimestamp } from './prisma/mappers/scalar.mapper';
import { PrismaService } from './prisma/prisma.service';
import { AiSettingsPrismaRepository } from './prisma/repositories/ai-settings.prisma.repository';
import { ProjectFilePrismaRepository } from './prisma/repositories/project-file.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * The AI migration against a real SQLite file: the `ai_settings` adapter (one row per user,
 * upsert, cascade), its CHECKs, and the widened `project_file.origin` CHECK (`derived_from:`)
 * with every older CHECK still in place after the table was redefined.
 */
loadEnv({
  path: ['apps/api/.env.local', 'apps/api/.env', '.env'],
  quiet: true,
});

const config = {
  get: (key: string) =>
    key === 'DATABASE_URL' ? process.env['DATABASE_URL'] : undefined,
} as unknown as ConfigService<Env, true>;

const prisma = new PrismaService(config);
const users = new UserPrismaRepository(prisma);
const projects = new ProjectPrismaRepository(prisma);
const files = new ProjectFilePrismaRepository(prisma);
const settings = new AiSettingsPrismaRepository(prisma);

let seq = 0;
async function newUser(name: string) {
  seq += 1;
  return users.upsertFromIdentity(
    {
      uid: `it-ai:${name}:${Date.now()}:${seq}`,
      email: `${name}@it.dev`,
      emailVerified: true,
      name,
      signInProvider: 'dev',
    },
    name,
  );
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ai_settings', () => {
  it('upserts one row per user and cascades with the account', async () => {
    const user = await newUser('ai-anna');
    expect(await settings.find(user.id)).toBeUndefined();
    const saved = await settings.save(user.id, {
      enabled: true,
      provider: 'anthropic',
      baseUrl: '',
      model: '',
      apiKeyCipher: 'enc:v1:aaa:bbb:ccc',
      apiKeyHint: '…1234',
      consentAt: null,
    });
    expect(saved).toMatchObject({
      userId: user.id,
      enabled: true,
      provider: 'anthropic',
      apiKeyHint: '…1234',
      consentAt: null,
    });
    const consent = '2026-10-07T08:00:00.000Z';
    const again = await settings.save(user.id, {
      ...saved,
      provider: 'openai_compatible',
      apiKeyCipher: null,
      apiKeyHint: null,
      consentAt: consent,
    });
    expect(again).toMatchObject({
      provider: 'openai_compatible',
      apiKeyCipher: null,
      consentAt: consent,
    });
    expect(await prisma.aiSettings.count({ where: { userId: user.id } })).toBe(
      1,
    );

    await prisma.user.delete({ where: { id: user.id } });
    expect(await settings.find(user.id)).toBeUndefined();
  });

  it('refuses bad providers, unsealed keys and long hints', async () => {
    const user = await newUser('ai-check');
    const now = toSqliteTimestamp(new Date());
    const insert = (columns: Record<string, unknown>) => {
      const row = {
        user_id: user.id,
        provider: 'openai_compatible',
        updated_at: now,
        ...columns,
      };
      const names = Object.keys(row);
      return prisma.$executeRawUnsafe(
        `INSERT INTO "ai_settings" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        ...Object.values(row),
      );
    };
    for (const bad of [
      { provider: 'gemini' },
      { api_key_cipher: 'sk-plain-text-key' },
      { api_key_hint: 'sk-entire-key-here' },
    ]) {
      await expect(insert(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
    await expect(insert({ api_key_cipher: 'enc:v1:a:b:c' })).resolves.toBe(1);
  });
});

describe('project_file after the AI migration', () => {
  it('accepts derived_from origins and keeps every older CHECK', async () => {
    const owner = await newUser('ai-derived');
    const project = await projects.create(owner.id, {
      name: 'Steuern 2025',
      taxYear: 2025,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    const bytes = new TextEncoder().encode('%PDF-1.4 synthetic');
    const pdf = await files.add({
      ownerId: owner.id,
      projectId: project.id,
      stored: {
        create: {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes,
          mediaType: 'application/pdf',
          kind: 'pdf',
          originalName: 's.pdf',
          source: 'uploaded',
          analysis: { ...NOT_ANALYSED, status: 'evidence_only' },
        },
      },
      displayName: 's.pdf',
      origin: 'uploaded',
    });
    if (!('created' in pdf)) throw new Error('expected a new entry');

    const csv = new TextEncoder().encode('Plattform,Asset\n');
    const derived = await files.add({
      ownerId: owner.id,
      projectId: project.id,
      stored: {
        create: {
          sha256: createHash('sha256').update(csv).digest('hex'),
          bytes: csv,
          mediaType: 'text/csv',
          kind: 'csv',
          originalName: 's.bestaende.csv',
          source: 'uploaded',
          analysis: NOT_ANALYSED,
        },
      },
      displayName: 's.bestaende.csv',
      origin: `derived_from:${pdf.created.id}`,
    });
    expect('created' in derived && derived.created.origin).toBe(
      `derived_from:${pdf.created.id}`,
    );

    const entry = (columns: Record<string, unknown>) => {
      const row = {
        id: randomUUID(),
        project_id: project.id,
        file_id: pdf.created.fileId,
        display_name: 'x.csv',
        origin: 'uploaded',
        added_at: toSqliteTimestamp(new Date()),
        ...columns,
      };
      const names = Object.keys(row);
      return prisma.$executeRawUnsafe(
        `INSERT INTO "project_file" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        ...Object.values(row),
      );
    };
    for (const bad of [
      { origin: 'derived_from:' },
      { origin: 'derived' },
      { display_name: ' ' },
    ]) {
      await expect(entry(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
    // The (project, file) pair is still unique after the redefinition.
    await expect(entry({})).rejects.toThrow(/UNIQUE constraint failed/);
  });
});
