import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { CorrectionData } from '@lazykoins/engine';
import type { Env } from '../config/env';
import { NOT_ANALYSED } from '../files/domain/project-file';
import { PrismaService } from './prisma/prisma.service';
import { CorrectionPrismaRepository } from './prisma/repositories/calculation.prisma.repository';
import {
  CarryoverPrismaRepository,
  ProjectBundlePrismaRepository,
  UserRatePrismaRepository,
} from './prisma/repositories/carryover.prisma.repository';
import { ProjectFilePrismaRepository } from './prisma/repositories/project-file.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * The carry-over migration against a real SQLite file: a bundle is written in ONE transaction
 * (a failure leaves nothing behind), stored files are reused by SHA-256, carry-over rows and the
 * dashboard rate cache with their CHECKs. `pnpm ci:integration` — never your dev database.
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
const corrections = new CorrectionPrismaRepository(prisma);
const bundles = new ProjectBundlePrismaRepository(prisma);
const carryovers = new CarryoverPrismaRepository(prisma);
const userRates = new UserRatePrismaRepository(prisma);

let seq = 0;
async function newUser() {
  seq += 1;
  return users.upsertFromIdentity(
    {
      uid: `it-carry:${Date.now()}:${seq}`,
      email: `carry${seq}@it.dev`,
      emailVerified: true,
      name: 'Carry',
      signInProvider: 'dev',
    },
    'Carry',
  );
}

const bytes = new TextEncoder().encode(
  'Plattform,Konto,Asset,Menge,Stichtag\n',
);
const sha = createHash('sha256').update(bytes).digest('hex');

const manual: CorrectionData = {
  type: 'manual_booking',
  booking: {
    platform: 'wallet',
    accountId: 'main',
    timestamp: '2025-06-01T00:00:00Z',
    asset: 'BTC',
    quantity: '0.1',
    kind: 'deposit',
  },
};

function bundle(name: string, stored: { existingId: string } | 'new') {
  return {
    target: {
      create: {
        name,
        taxYear: 2026,
        country: 'CH' as const,
        canton: 'ZH',
        notes: '',
      },
    },
    mappings: [],
    files: [
      {
        key: 'f1',
        stored:
          stored === 'new'
            ? {
                create: {
                  sha256: sha,
                  bytes,
                  mediaType: 'text/csv',
                  kind: 'csv' as const,
                  originalName: 'a.csv',
                },
              }
            : stored,
        displayName: 'a.csv',
        origin: 'uploaded',
        analysis: { ...NOT_ANALYSED, status: 'standard' as const },
        mappingKey: null,
      },
    ],
    corrections: [
      {
        key: 'c1',
        data: manual,
        reason: 'Wallet',
        createdAt: '2025-07-01T00:00:00.000Z',
        undoneAt: '2025-07-02T00:00:00.000Z',
      },
    ],
    rates: [
      {
        kind: 'price' as const,
        asset: 'BTC',
        currency: 'USD' as const,
        date: '2025-12-31',
        value: '90000',
        source: 'binance' as const,
      },
    ],
    openItemStates: [{ carryoverKey: 'o1', done: true, note: 'ok' }],
    exports: [],
    carryovers: [
      {
        key: 'o1',
        sourceProjectId: null,
        sourceProjectName: 'Steuern 2025',
        kind: 'open_item' as const,
        label: 'x',
        data: { note: 'n' },
      },
      {
        sourceProjectId: null,
        sourceProjectName: 'Steuern 2025',
        kind: 'file' as const,
        refFileKey: 'f1',
        label: 'a.csv',
        data: {},
      },
    ],
  };
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('carry-over persistence', () => {
  it('writes a bundle in one go and reuses the stored file by SHA-256', async () => {
    const user = await newUser();
    const first = await bundles.write(user.id, bundle('Eins', 'new'));
    expect(first).toMatchObject({
      files: 1,
      storedFilesCreated: 1,
      corrections: 1,
    });
    // A second bundle with the same bytes: the stored file is found, not stored again.
    const second = await bundles.write(user.id, bundle('Zwei', 'new'));
    expect(second.storedFilesCreated).toBe(0);
    const [entry] = await files.listByProject(second.projectId);
    expect(entry?.sha256).toBe(sha);
    const [kept] = await corrections.listByProject(first.projectId);
    expect(kept).toMatchObject({
      createdAt: '2025-07-01T00:00:00.000Z',
      undoneAt: '2025-07-02T00:00:00.000Z',
    });
    const rows = await carryovers.listByProject(first.projectId);
    expect(rows.map((r) => r.kind)).toEqual(['open_item', 'file']);
    expect(rows[1]?.ref).toBe(
      entry && (await files.listByProject(first.projectId))[0]?.id,
    );
    const state = await prisma.openItemState.findFirst({
      where: { projectId: first.projectId },
    });
    expect(state?.itemKey).toBe(`carried:${rows[0]?.id}`);
  });

  it('leaves nothing behind when a part fails', async () => {
    const user = await newUser();
    const broken = bundle('Kaputt', 'new');
    await expect(
      bundles.write(user.id, {
        ...broken,
        corrections: [{ ...broken.corrections[0], key: 'c1', reason: '   ' }],
      } as never),
    ).rejects.toThrow();
    expect(await projects.findByOwner(user.id)).toEqual([]);
    expect(await files.findStoredBySha(user.id, sha)).toBeUndefined();
  });

  it('keeps the rate cache per user, refuses overrides and checks its columns', async () => {
    const user = await newUser();
    const entry = {
      kind: 'price' as const,
      asset: 'DOT',
      currency: 'USD' as const,
      date: '2025-12-31',
      value: '5',
      source: 'binance' as const,
    };
    expect(
      await userRates.upsertMany(user.id, [
        entry,
        { ...entry, value: '5.5' },
        { ...entry, source: 'manual' },
      ]),
    ).toBe(2);
    expect(await userRates.listByUser(user.id)).toEqual([
      { ...entry, value: '5.5' },
    ]);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO user_rate (id, user_id, kind, asset, currency, date, value, source) VALUES ('ur1', ?, 'price', 'X', 'USD', '2025-01-01', '1', 'manual')`,
        user.id,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    const project = await projects.create(user.id, {
      name: 'P',
      taxYear: 2025,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO project_carryover (id, project_id, source_project_name, kind, data) VALUES ('pc1', ?, 'x', 'mapping', '{}')`,
        project.id,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO project_carryover (id, project_id, source_project_name, kind, data) VALUES ('pc2', ?, 'x', 'file', 'not json')`,
        project.id,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
