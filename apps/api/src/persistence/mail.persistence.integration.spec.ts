import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { NOT_ANALYSED } from '../files/domain/project-file';
import { toSqliteTimestamp } from './prisma/mappers/scalar.mapper';
import { PrismaService } from './prisma/prisma.service';
import {
  MailLogPrismaRepository,
  MailSettingsPrismaRepository,
  MailTemplatePrismaRepository,
} from './prisma/repositories/mail.prisma.repository';
import { ProjectFilePrismaRepository } from './prisma/repositories/project-file.prisma.repository';
import { ProjectSentPrismaRepository } from './prisma/repositories/project-sent.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';
import { UserSettingsPrismaRepository } from './prisma/repositories/user-settings.prisma.repository';

/**
 * The mail migration against a real SQLite file: the adapters of `mail_settings`,
 * `mail_template`, `mail_log` and `project_sent_state` (upsert, cascade, change facts across
 * tables) and their CHECKs.
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
const mailSettings = new MailSettingsPrismaRepository(prisma);
const templates = new MailTemplatePrismaRepository(prisma);
const log = new MailLogPrismaRepository(prisma);
const sent = new ProjectSentPrismaRepository(prisma);

let seq = 0;
async function newUser(name: string) {
  seq += 1;
  return users.upsertFromIdentity(
    {
      uid: `it-mail:${name}:${Date.now()}:${seq}`,
      email: `${name}@it.dev`,
      emailVerified: true,
      name,
      signInProvider: 'dev',
    },
    name,
  );
}

async function newProject(ownerId: string) {
  return projects.create(ownerId, {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
}

/** Inserts a row with raw SQL so a CHECK (not the adapter) decides. */
function insert(table: string, row: Record<string, unknown>) {
  const names = Object.keys(row);
  return prisma.$executeRawUnsafe(
    `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    ...Object.values(row),
  );
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('mail_settings', () => {
  it('upserts one row per user and cascades with the account', async () => {
    const user = await newUser('mail-anna');
    expect(await mailSettings.find(user.id)).toBeUndefined();
    const saved = await mailSettings.save(user.id, {
      enabled: true,
      host: 'smtp.example.ch',
      port: 465,
      security: 'tls',
      username: 'anna',
      passwordCipher: 'enc:v1:a:b:c',
      passwordHint: '…1234',
      fromName: 'Anna',
      fromAddress: 'anna@example.ch',
    });
    expect(saved).toMatchObject({ port: 465, security: 'tls', enabled: true });
    await mailSettings.save(user.id, {
      ...saved,
      passwordCipher: null,
      passwordHint: null,
    });
    expect(
      await prisma.mailSettings.count({ where: { userId: user.id } }),
    ).toBe(1);
    expect((await mailSettings.find(user.id))?.passwordCipher).toBeNull();
    await prisma.user.delete({ where: { id: user.id } });
    expect(await mailSettings.find(user.id)).toBeUndefined();
  });

  it('refuses bad security, ports, unsealed passwords and long hints', async () => {
    const user = await newUser('mail-check');
    const now = toSqliteTimestamp(new Date());
    const row = (columns: Record<string, unknown>) => ({
      user_id: user.id,
      updated_at: now,
      ...columns,
    });
    for (const bad of [
      { security: 'ssl' },
      { port: 0 },
      { port: 70000 },
      { password_cipher: 'plain-password' },
      { password_hint: 'the-whole-password' },
    ]) {
      await expect(insert('mail_settings', row(bad))).rejects.toThrow(
        /CHECK constraint failed/,
      );
    }
    await expect(
      insert('mail_settings', row({ password_cipher: 'enc:v1:x' })),
    ).resolves.toBe(1);
  });
});

describe('mail_template', () => {
  it('stores one template per user and language, and removes it', async () => {
    const user = await newUser('mail-template');
    expect(await templates.find(user.id, 'de-CH')).toBeUndefined();
    await templates.save(user.id, 'de-CH', { subject: 'A', body: 'B' });
    const again = await templates.save(user.id, 'de-CH', {
      subject: 'Steuern {{steuerjahr}}',
      body: 'Text',
    });
    expect(again).toMatchObject({
      language: 'de-CH',
      subject: 'Steuern {{steuerjahr}}',
    });
    expect(await templates.remove(user.id, 'de-CH')).toBe(true);
    expect(await templates.remove(user.id, 'de-CH')).toBe(false);
  });

  it('refuses unknown languages and empty texts', async () => {
    const user = await newUser('mail-template-check');
    const now = toSqliteTimestamp(new Date());
    for (const bad of [
      { language: 'xx', subject: 'a', body: 'b' },
      { language: 'de-CH', subject: '', body: 'b' },
      { language: 'de-CH', subject: 'a', body: '' },
    ]) {
      await expect(
        insert('mail_template', { user_id: user.id, updated_at: now, ...bad }),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });

  it('keeps one template per language — German and English (F11.2)', async () => {
    const user = await newUser('mail-template-en');
    await templates.save(user.id, 'de-CH', {
      subject: 'Steuern',
      body: 'Text',
    });
    await templates.save(user.id, 'en', { subject: 'Taxes', body: 'Text' });
    expect((await templates.find(user.id, 'en'))?.subject).toBe('Taxes');
    expect((await templates.find(user.id, 'de-CH'))?.subject).toBe('Steuern');
  });
});

describe('user_settings language and formats (F11.2)', () => {
  it('stores locale, number and date format and refuses unknown values', async () => {
    const user = await newUser('settings-locale');
    const settings = new UserSettingsPrismaRepository(prisma);
    expect((await settings.save(user.id, { canton: 'ZH' })).locale).toBeNull();
    const saved = await settings.save(user.id, {
      locale: 'en',
      numberFormat: 'en',
      dateFormat: 'MM/dd/yyyy',
    });
    expect(saved).toMatchObject({
      locale: 'en',
      numberFormat: 'en',
      dateFormat: 'MM/dd/yyyy',
    });
    for (const [column, value] of [
      ['locale', 'fr'],
      ['number_format', 'fr-FR'],
      ['date_format', 'yyyy/MM/dd'],
    ] as const) {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE user_settings SET ${column} = ? WHERE user_id = ?`,
          value,
          user.id,
        ),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });
});

describe('mail_log and project_sent_state', () => {
  it('logs per project, newest first, and cascades with the project', async () => {
    const owner = await newUser('mail-log');
    const project = await newProject(owner.id);
    const first = await log.add(project.id, {
      to: 'treuhand@example.ch',
      cc: null,
      subject: 'S',
      attachments: [{ exportId: 'e1', fileName: 'a.pdf', size: 3 }],
      status: 'failed',
      error: 'auth – 535',
      messageId: null,
    });
    const second = await log.add(project.id, {
      to: 'treuhand@example.ch',
      cc: 'anna@example.ch',
      subject: 'S',
      attachments: [],
      status: 'sent',
      error: null,
      messageId: '<1@x>',
    });
    const listed = await log.listByProject(project.id);
    expect(listed.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(listed[1]?.attachments).toEqual([
      { exportId: 'e1', fileName: 'a.pdf', size: 3 },
    ]);

    await sent.save(project.id, {
      sentAt: second.createdAt,
      sentTo: 'treuhand@example.ch',
      via: 'mail',
      note: '',
      exportIds: ['e1'],
      mailLogId: second.id,
      snapshotHash: null,
    });
    await prisma.project.delete({ where: { id: project.id } });
    expect(await log.listByProject(project.id)).toEqual([]);
    expect(await sent.find(project.id)).toBeUndefined();
  });

  it('refuses bad statuses, failures without an error, bad ways and non-JSON lists', async () => {
    const owner = await newUser('mail-log-check');
    const project = await newProject(owner.id);
    const base = {
      id: `${Date.now()}-x`,
      project_id: project.id,
      to_address: 'a@b.ch',
      subject: 's',
      status: 'sent',
    };
    let n = 0;
    for (const bad of [
      { status: 'queued' },
      { status: 'failed' },
      { attachments: 'not json' },
      { attachments: '{}' },
    ]) {
      n += 1;
      await expect(
        insert('mail_log', { ...base, id: `${base.id}${n}`, ...bad }),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
    const now = toSqliteTimestamp(new Date());
    for (const bad of [
      { sent_via: 'pigeon' },
      { sent_via: 'mail', sent_exports: '"e1"' },
    ]) {
      await expect(
        insert('project_sent_state', {
          project_id: project.id,
          sent_to_advisor_at: now,
          updated_at: now,
          ...bad,
        }),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });

  it('reads the change facts of several projects in one go', async () => {
    const owner = await newUser('mail-facts');
    const project = await newProject(owner.id);
    const quiet = await newProject(owner.id);
    await prisma.calculationSnapshot.create({
      data: {
        projectId: project.id,
        inputHash: 'a'.repeat(64),
        engineVersion: 1,
        result: '{}',
        records: '{}',
        wealthChf: '1',
        incomeChf: '1',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await prisma.calculationSnapshot.create({
      data: {
        projectId: project.id,
        inputHash: 'b'.repeat(64),
        engineVersion: 1,
        result: '{}',
        records: '{}',
        wealthChf: '1',
        incomeChf: '1',
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
      },
    });
    const exported = await prisma.projectExport.create({
      data: {
        projectId: project.id,
        kind: 'simple_pdf',
        fileName: 'a.pdf',
        mediaType: 'application/pdf',
        bytes: new Uint8Array([1]),
        size: 1,
        wealthChf: '1',
        incomeChf: '1',
        createdAt: new Date('2026-10-03T00:00:00.000Z'),
      },
    });
    await prisma.correction.create({
      data: {
        projectId: project.id,
        type: 'price_override',
        data: '{}',
        reason: 'r',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        undoneAt: new Date('2026-10-04T00:00:00.000Z'),
      },
    });
    const bytes = new TextEncoder().encode('Plattform,Asset\n');
    await files.add({
      ownerId: owner.id,
      projectId: project.id,
      stored: {
        create: {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes,
          mediaType: 'text/csv',
          kind: 'csv',
          originalName: 'x.csv',
          source: 'uploaded',
          analysis: NOT_ANALYSED,
        },
      },
      displayName: 'x.csv',
      origin: 'uploaded',
    });

    const facts = await sent.changeFacts([project.id, quiet.id]);
    const own = facts.get(project.id);
    expect(own?.latestSnapshot).toEqual({
      createdAt: '2026-10-02T00:00:00.000Z',
      inputHash: 'b'.repeat(64),
    });
    expect(own?.exports).toEqual([
      { id: exported.id, createdAt: '2026-10-03T00:00:00.000Z' },
    ]);
    expect(own?.lastCorrectionAt).toBe('2026-10-04T00:00:00.000Z');
    expect(own?.lastFileAddedAt).not.toBeNull();
    expect(facts.get(quiet.id)).toEqual({
      latestSnapshot: null,
      exports: [],
      lastCorrectionAt: null,
      lastFileAddedAt: null,
    });

    const states = await sent.findMany([project.id, quiet.id]);
    expect(states.size).toBe(0);
    await sent.save(quiet.id, {
      sentAt: '2026-10-05T08:00:00.000Z',
      sentTo: '',
      via: 'personal',
      note: 'übergeben',
      exportIds: [],
      mailLogId: null,
      snapshotHash: null,
    });
    expect(
      (await sent.findMany([project.id, quiet.id])).get(quiet.id),
    ).toMatchObject({
      sentAt: '2026-10-05T08:00:00.000Z',
      via: 'personal',
      note: 'übergeben',
    });
    expect(await sent.remove(quiet.id)).toBe(true);
    expect(await sent.remove(quiet.id)).toBe(false);
  });
});
