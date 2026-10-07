import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { StoredResult } from '../calculation/domain/calculation';
import type { Env } from '../config/env';
import { PrismaService } from './prisma/prisma.service';
import {
  CalculationSnapshotPrismaRepository,
  CorrectionPrismaRepository,
  OpenItemStatePrismaRepository,
} from './prisma/repositories/calculation.prisma.repository';
import { CoinMarketPrismaRepository } from './prisma/repositories/coin-market.prisma.repository';
import { ProjectExportPrismaRepository } from './prisma/repositories/project-export.prisma.repository';
import { ProjectRatePrismaRepository } from './prisma/repositories/project-rate.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserSettingsPrismaRepository } from './prisma/repositories/user-settings.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';

/**
 * The adapters of the calculation migration against a real SQLite file: settings upsert, rate
 * upserts by their unique key, snapshot retention and the list figures, correction undo, item
 * states, stored exports, the cascade with the project and the hand-written CHECKs.
 * `pnpm ci:integration` — never your dev database.
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
const settings = new UserSettingsPrismaRepository(prisma);
const rates = new ProjectRatePrismaRepository(prisma);
const snapshots = new CalculationSnapshotPrismaRepository(prisma);
const corrections = new CorrectionPrismaRepository(prisma);
const states = new OpenItemStatePrismaRepository(prisma);
const exportsRepo = new ProjectExportPrismaRepository(prisma);
const market = new CoinMarketPrismaRepository(prisma);

let seq = 0;
async function newProject() {
  seq += 1;
  const user = await users.upsertFromIdentity(
    {
      uid: `it-calc:${Date.now()}:${seq}`,
      email: `calc${seq}@it.dev`,
      emailVerified: true,
      name: 'Calc',
      signInProvider: 'dev',
    },
    'Calc',
  );
  const project = await projects.create(user.id, {
    name: 'Steuern 2025',
    taxYear: 2025,
    country: 'CH',
    canton: 'ZH',
    notes: '',
  });
  return { user, project };
}

function result(wealthChf: string): StoredResult {
  return {
    engineVersion: 1,
    taxYear: 2025,
    country: 'CH',
    currency: 'CHF',
    yearEnd: '2025-12-31',
    totals: {
      wealthChf,
      incomeChf: '1.5',
      positions: 0,
      missingPrices: 0,
      openItems: 0,
    },
    parameters: {
      usdChf: null,
      eurChf: null,
      usdChfSource: null,
      eurChfSource: null,
    },
    positions: [],
    platforms: [],
    income: [],
    categories: [],
    earnGaps: [],
    oneOffEvents: [],
    checks: [],
    openItems: [],
    corrections: [],
    comparison: null,
  };
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('user settings', () => {
  it('creates on first save, keeps absent fields, stores sealed keys', async () => {
    const { user } = await newProject();
    expect(await settings.find(user.id)).toBeUndefined();
    const created = await settings.save(user.id, {
      displayName: 'Anna',
      sealedKeys: { coingecko: 'enc:v1:a:b:c' },
      coinChoices: {
        OPN: {
          provider: 'coingecko',
          id: 'open-ticketing-ecosystem',
          name: 'OPEN Ticketing Ecosystem',
          symbol: 'OPN',
        },
      },
    });
    expect(created).toMatchObject({
      displayName: 'Anna',
      onlineRates: true,
      sealedKeys: { coingecko: 'enc:v1:a:b:c', etherscan: null },
      coinChoices: {
        OPN: {
          id: 'open-ticketing-ecosystem',
          name: 'OPEN Ticketing Ecosystem',
        },
      },
    });
    const updated = await settings.save(user.id, {
      onlineRates: false,
      sealedKeys: { coingecko: null },
    });
    expect(updated).toMatchObject({
      displayName: 'Anna',
      onlineRates: false,
      sealedKeys: { coingecko: null },
    });
    await expect(
      settings.save(user.id, { sealedKeys: { etherscan: 'plain-key' } }),
    ).rejects.toThrow();
    // F7.4: the coin choices must be a JSON object (migration 20261009090000_coin_choices).
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE user_settings SET coin_choices = '[]' WHERE user_id = '${user.id}'`,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    // The older shape (symbol → CoinGecko id) still reads, as a choice without a name.
    await prisma.$executeRawUnsafe(
      `UPDATE user_settings SET coin_choices = '{"pol":"polygon-ecosystem-token"}' WHERE user_id = '${user.id}'`,
    );
    expect((await settings.find(user.id))?.coinChoices).toEqual({
      POL: {
        provider: 'coingecko',
        id: 'polygon-ecosystem-token',
        name: null,
        symbol: null,
      },
    });
  });
});

describe('coin market list (F7.4)', () => {
  it('replaces the whole list, reads by symbol (best rank first) and knows when', async () => {
    const coin = (id: string, symbol: string, rank: number) => ({
      provider: 'coingecko' as const,
      id,
      name: id,
      symbol,
      marketCapRank: rank,
      priceUsd: '0.5',
    });
    await market.replace(
      'coingecko',
      [coin('b', 'ONE', 649), coin('a', 'ONE', 366), coin('c', 'DOT', 20)],
      '2026-10-07T10:00:00.000Z',
    );
    await market.replace(
      'coingecko',
      [
        coin('harmony', 'ONE', 649),
        coin('cross-2', 'ONE', 366),
        coin('polkadot', 'DOT', 20),
      ],
      '2026-10-08T10:00:00.000Z',
    );
    expect(
      (await market.listBySymbols('coingecko', ['ONE'])).map((c) => c.id),
    ).toEqual(['cross-2', 'harmony']);
    expect(await market.listBySymbols('coingecko', [])).toEqual([]);
    // Only tickers that ≥ 2 coins up to the rank carry.
    expect(
      (await market.listShared('coingecko', 2000)).map((c) => c.id),
    ).toEqual(['cross-2', 'harmony']);
    expect(await market.listShared('coingecko', 500)).toEqual([]);
    expect(await market.fetchedAt('coingecko')).toBe(
      '2026-10-08T10:00:00.000Z',
    );
    await expect(
      market.replace(
        'coingecko',
        [{ ...coin('x', 'one', 1) }],
        '2026-10-08T10:00:00.000Z',
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});

describe('project rates', () => {
  it('upserts by (kind, asset, currency, date, source) and deletes one', async () => {
    const { project } = await newProject();
    const entry = {
      kind: 'price' as const,
      asset: 'BTC',
      currency: 'USD' as const,
      date: '2025-12-31',
      value: '90000.123456789012345678',
      source: 'binance' as const,
    };
    await rates.upsertMany(project.id, [entry, { ...entry, source: 'manual' }]);
    await rates.upsertMany(project.id, [{ ...entry, value: '91000' }]);
    const stored = await rates.listByProject(project.id);
    expect(stored.map((r) => [r.source, r.value])).toEqual([
      ['binance', '91000'],
      ['manual', '90000.123456789012345678'],
    ]);
    expect(await rates.delete(project.id, { ...entry, source: 'manual' })).toBe(
      true,
    );
    expect(await rates.delete(project.id, { ...entry, source: 'manual' })).toBe(
      false,
    );
    // F7.4: removing the fetched prices of one asset keeps overrides and other assets.
    await rates.upsertMany(project.id, [
      { ...entry, source: 'manual' },
      { ...entry, source: 'coingecko', currency: 'CHF' },
      { ...entry, asset: 'ETH' },
    ]);
    expect(await rates.deleteFetchedPrices(project.id, 'BTC')).toBe(2);
    expect(
      (await rates.listByProject(project.id)).map(
        (r) => `${r.asset}|${r.source}`,
      ),
    ).toEqual(['BTC|manual', 'ETH|binance']);
    await rates.delete(project.id, { ...entry, source: 'manual' });
    await rates.delete(project.id, { ...entry, asset: 'ETH' });
    await rates.upsertMany(project.id, [entry]);
    await expect(
      rates.upsertMany(project.id, [{ ...entry, source: 'yahoo' as never }]),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      rates.upsertMany(project.id, [{ ...entry, value: '1e5' }]),
    ).rejects.toThrow(/CHECK constraint failed/);
    // F4.1a: any ISO 4217 code (a tax currency), never anything else.
    await rates.upsertMany(project.id, [
      { ...entry, kind: 'fx', asset: 'USD', currency: 'EUR', value: '0.85' },
    ]);
    expect(
      (await rates.listByProject(project.id)).some((r) => r.currency === 'EUR'),
    ).toBe(true);
    for (const currency of ['eur', 'EURO', 'E1']) {
      await expect(
        rates.upsertMany(project.id, [{ ...entry, currency }]),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });
});

describe('snapshots, corrections, open items, exports', () => {
  it('keeps the latest three snapshots and reads the list figures from the newest', async () => {
    const { project } = await newProject();
    for (const wealth of ['1', '2', '3', '4']) {
      await snapshots.save(project.id, {
        inputHash: 'b'.repeat(64),
        engineVersion: 1,
        result: result(wealth),
        records: { r1: { id: 'r1' } as never },
      });
    }
    const latest = await snapshots.latest(project.id);
    expect(latest?.result.totals.wealthChf).toBe('4');
    expect(await snapshots.records(latest?.id ?? '')).toEqual({
      r1: { id: 'r1' },
    });
    expect(
      await prisma.calculationSnapshot.count({
        where: { projectId: project.id },
      }),
    ).toBe(3);
    const figures = await snapshots.latestFigures([project.id, 'nope']);
    expect(figures.get(project.id)).toMatchObject({
      wealthChf: '4',
      incomeChf: '1.5',
    });
    expect(figures.has('nope')).toBe(false);
  });

  it('undoes and redoes a correction, keeps item states, stores exports — and cascades', async () => {
    const { project } = await newProject();
    const correction = await corrections.create(project.id, {
      data: {
        type: 'price_override',
        asset: 'ETH',
        date: '2025-12-31',
        priceChf: '2500',
      },
      reason: 'ESTV',
    });
    expect(
      (await corrections.setUndone(correction.id, true))?.undoneAt,
    ).not.toBeNull();
    expect(
      (await corrections.setUndone(correction.id, false))?.undoneAt,
    ).toBeNull();
    expect(await corrections.listByProject(project.id)).toEqual([
      expect.objectContaining({ type: 'price_override', reason: 'ESTV' }),
    ]);

    await states.save(project.id, 'missingPrice:pos:x', { done: true });
    await states.save(project.id, 'missingPrice:pos:x', { note: 'erledigt' });
    expect(await states.listByProject(project.id)).toEqual([
      expect.objectContaining({ done: true, note: 'erledigt' }),
    ]);

    const bytes = new TextEncoder().encode('%PDF-1.4 synthetic');
    const meta = await exportsRepo.create(project.id, {
      kind: 'simple_pdf',
      fileName: 'a.pdf',
      bytes,
      snapshotId: null,
      wealthChf: '1',
      incomeChf: '2',
    });
    expect(meta).toMatchObject({
      size: bytes.byteLength,
      mediaType: 'application/pdf',
    });
    const content = await exportsRepo.findContent(meta.id);
    expect(Buffer.from(content?.bytes ?? []).toString()).toBe(
      '%PDF-1.4 synthetic',
    );
    expect(await exportsRepo.listByProject(project.id)).toHaveLength(1);

    await projects.delete(project.id);
    expect(await corrections.findById(correction.id)).toBeUndefined();
    expect(await exportsRepo.findContent(meta.id)).toBeUndefined();
    expect(await states.listByProject(project.id)).toEqual([]);
  });

  it('keeps the CHECK constraints of the calculation migration', async () => {
    const { project } = await newProject();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO correction (id, project_id, type, data, reason) VALUES ('x1', ?, 'delete_all', '{}', 'r')`,
        project.id,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO correction (id, project_id, type, data, reason) VALUES ('x2', ?, 'reclassify', '{}', '  ')`,
        project.id,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO calculation_snapshot (id, project_id, input_hash, engine_version, result, records, wealth_chf, income_chf) VALUES ('x3', ?, 'short', 1, '{}', '{}', '0', '0')`,
        project.id,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO project_export (id, project_id, kind, file_name, media_type, bytes, size, wealth_chf, income_chf) VALUES ('x4', ?, 'zip', 'a', 'b', X'00', 1, '0', '0')`,
        project.id,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
    // Widened by 20261008090000 for the internal check report (F10.2a); size CHECK kept.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO project_export (id, project_id, kind, file_name, media_type, bytes, size, wealth_chf, income_chf) VALUES ('x5', ?, 'internal_report_xlsx', 'a', 'b', X'00', 1, '0', '0')`,
        project.id,
      ),
    ).resolves.toBe(1);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO project_export (id, project_id, kind, file_name, media_type, bytes, size, wealth_chf, income_chf) VALUES ('x6', ?, 'internal_report_pdf', 'a', 'b', X'00', 2, '0', '0')`,
        project.id,
      ),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
