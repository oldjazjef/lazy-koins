import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { EstvVersion } from '../rates/domain/estv';
import { crypto, fx } from '../rates/testing/in-memory-estv';
import { PrismaService } from './prisma/prisma.service';
import { EstvKurslistePrismaRepository } from './prisma/repositories/estv-kursliste.prisma.repository';
import { ProjectRatePrismaRepository } from './prisma/repositories/project-rate.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * The ESTV Kursliste store (migration `20261008090000_estv_kursliste`) against a real SQLite
 * file: one version per year replaced with its values, the checks, the project-rate label and
 * the hand-written CHECKs. `pnpm ci:integration` — never your dev database.
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
const estv = new EstvKurslistePrismaRepository(prisma);
const rates = new ProjectRatePrismaRepository(prisma);
const users = new UserPrismaRepository(prisma);
const projects = new ProjectPrismaRepository(prisma);

/** A year no other spec uses, per run (the test database is shared by the specs). */
const year = 2000 + (Date.now() % 90);

const version = (fileHash: string, exportDate: string): EstvVersion => ({
  year,
  exportType: 'THIRD.INIT.220',
  exportDate,
  fileHash,
  fileName: `kursliste_${year}.zip`,
  schemaVersion: '2.2.0',
  downloadedAt: '2026-04-01T10:00:00.000Z',
  entryCount: 3,
  cryptoCount: 2,
});

beforeAll(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await prisma.estvKursliste.deleteMany({ where: { year } });
  await prisma.estvCheck.deleteMany({ where: { year } });
});

afterAll(async () => {
  await prisma.estvKursliste.deleteMany({ where: { year } });
  await prisma.estvCheck.deleteMany({ where: { year } });
  await prisma.$disconnect();
});

describe('ESTV Kursliste store (F7.4a)', () => {
  it('replaces a year with its values and keeps only the newest version', async () => {
    await estv.replaceYear(version('h1', '2026-03-02T08:00:00.000Z'), [
      crypto('BTC', 'Bitcoin', '70000.123456', '39714275'),
      crypto('ETH', 'Ethereum', '2400.5'),
      fx('USD', '0.79225'),
    ]);
    expect(await estv.findVersion(year)).toEqual(
      version('h1', '2026-03-02T08:00:00.000Z'),
    );
    expect((await estv.listRates(year)).map((r) => r.symbol)).toEqual([
      'BTC',
      'ETH',
      'USD',
    ]);
    await estv.replaceYear(
      {
        ...version('h2', '2026-05-01T08:00:00.000Z'),
        entryCount: 1,
        cryptoCount: 1,
      },
      [crypto('BTC', 'Bitcoin', '71000')],
    );
    expect((await estv.findVersion(year))?.fileHash).toBe('h2');
    expect(await estv.listRates(year)).toEqual([
      crypto('BTC', 'Bitcoin', '71000'),
    ]);
    expect((await estv.listVersions()).some((v) => v.year === year)).toBe(true);
  });

  it('upserts the check of a year', async () => {
    await estv.saveCheck({
      year,
      checkedAt: '2026-04-01T10:00:00.000Z',
      outcome: 'failed',
      error: 'ICTax: nicht erreichbar',
    });
    await estv.saveCheck({
      year,
      checkedAt: '2026-04-02T10:00:00.000Z',
      outcome: 'current',
      error: null,
    });
    expect((await estv.listChecks()).find((c) => c.year === year)).toEqual({
      year,
      checkedAt: '2026-04-02T10:00:00.000Z',
      outcome: 'current',
      error: null,
    });
  });

  it('keeps the ESTV label of a project rate and clears it when overwritten', async () => {
    const user = await users.upsertFromIdentity(
      {
        uid: `it-estv:${Date.now()}`,
        email: 'estv@it.dev',
        emailVerified: true,
        name: 'Estv',
        signInProvider: 'dev',
      },
      'Estv',
    );
    const project = await projects.create(user.id, {
      name: 'Steuern 2025',
      taxYear: 2025,
      country: 'CH',
      canton: 'ZH',
      notes: '',
    });
    const entry = {
      kind: 'price' as const,
      asset: 'BTC',
      currency: 'CHF' as const,
      date: '2025-12-31',
      value: '70000',
      source: 'estv' as const,
    };
    await rates.upsertMany(project.id, [
      { ...entry, note: 'ESTV-Kursliste 2025, Stand 02.03.2026' },
    ]);
    expect((await rates.listByProject(project.id))[0]?.note).toBe(
      'ESTV-Kursliste 2025, Stand 02.03.2026',
    );
    await rates.upsertMany(project.id, [{ ...entry, value: '69000' }]);
    expect((await rates.listByProject(project.id))[0]).toMatchObject({
      value: '69000',
      note: null,
    });
  });

  it('enforces the CHECKs', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO estv_kursliste (year, export_type, export_date, file_hash, file_name, schema_version, downloaded_at, entry_count, crypto_count) VALUES (1999, 'THIRD.INIT.220', '2026-01-01T00:00:00.000+00:00', 'h', 'f', '2.2.0', '2026-01-01T00:00:00.000+00:00', 1, 1)`,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO estv_kursliste (year, export_type, export_date, file_hash, file_name, schema_version, downloaded_at, entry_count, crypto_count) VALUES (2099, 'THIRD.DELTA.220', '2026-01-01T00:00:00.000+00:00', 'h', 'f', '2.2.0', '2026-01-01T00:00:00.000+00:00', 1, 1)`,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO estv_kursliste (year, export_type, export_date, file_hash, file_name, schema_version, downloaded_at, entry_count, crypto_count) VALUES (2099, 'THIRD.INIT.220', '2026-01-01T00:00:00.000+00:00', 'h', 'f', '2.2.0', '2026-01-01T00:00:00.000+00:00', 1, 2)`,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO estv_rate (id, year, kind, symbol, name, value) VALUES ('e1', ?, 'share', 'X', 'X', '1')`,
        year,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO estv_rate (id, year, kind, symbol, name, value) VALUES ('e2', ?, 'crypto', 'X', 'X', '-1')`,
        year,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO estv_check (year, checked_at, outcome) VALUES (?, '2026-01-01T00:00:00.000+00:00', 'maybe')`,
        year,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
