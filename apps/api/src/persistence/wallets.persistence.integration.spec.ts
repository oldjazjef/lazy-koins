import { createHash, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { NOT_ANALYSED } from '../files/domain/project-file';
import { toSqliteTimestamp } from './prisma/mappers/scalar.mapper';
import { PrismaService } from './prisma/prisma.service';
import { ProjectFilePrismaRepository } from './prisma/repositories/project-file.prisma.repository';
import { ProjectPrismaRepository } from './prisma/repositories/project.prisma.repository';
import { UserPrismaRepository } from './prisma/repositories/user.prisma.repository';
import {
  ChainSettingsPrismaRepository,
  WalletPrismaRepository,
} from './prisma/repositories/wallet.prisma.repository';

/**
 * The wallets migration against a real SQLite file: the wallet adapter (owner listing, project
 * links, fetched data upsert, overrides, manual balances, cascades), the chain settings, their
 * CHECKs, and the widened `project_file.origin` CHECK (`wallet:`) with every older CHECK intact.
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
const wallets = new WalletPrismaRepository(prisma);
const chainSettings = new ChainSettingsPrismaRepository(prisma);

const EVM = '0x1111111111111111111111111111111111111111';

let seq = 0;
async function newUser(name: string) {
  seq += 1;
  return users.upsertFromIdentity(
    {
      uid: `it-wallet:${name}:${Date.now()}:${seq}`,
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

describe('wallet adapter', () => {
  it('lists by owner, links projects, stores data, overrides and balances; cascades', async () => {
    const anna = await newUser('w-anna');
    const bob = await newUser('w-bob');
    const project = await newProject(anna.id);
    const wallet = await wallets.create({
      ownerId: anna.id,
      label: 'Ledger',
      address: EVM,
      addressKind: 'evm',
      networks: ['ethereum', 'base'],
      notes: '',
    });
    await wallets.create({
      ownerId: bob.id,
      label: 'Bob',
      address: EVM,
      addressKind: 'evm',
      networks: ['ethereum'],
      notes: '',
    });
    expect((await wallets.listByOwner(anna.id)).map((w) => w.id)).toEqual([
      wallet.id,
    ]);
    expect(
      (await wallets.update(wallet.id, { networks: ['ethereum'] }))?.networks,
    ).toEqual(['ethereum']);
    await wallets.saveNetworkCheck(wallet.id, {
      checkedAt: '2026-10-08T10:00:00.000Z',
      results: [
        {
          network: 'ethereum',
          used: true,
          txCount: 3,
          errorCode: null,
          detail: null,
        },
      ],
    });
    expect(
      (await wallets.findById(wallet.id))?.networkCheck?.results,
    ).toHaveLength(1);

    await wallets.addToProject(project.id, wallet.id);
    await wallets.addToProject(project.id, wallet.id);
    expect(await wallets.listWalletIds(project.id)).toEqual([wallet.id]);
    expect(await wallets.listProjectIds(wallet.id)).toEqual([project.id]);

    const data = {
      walletId: wallet.id,
      network: 'ethereum' as const,
      status: 'ok' as const,
      errorCode: null,
      errorDetail: null,
      movements: [
        {
          txHash: '0x01',
          timestamp: '2025-01-01T00:00:00.000Z',
          asset: 'ETH',
          tokenId: null,
          tokenName: null,
          quantity: '0.123456789012345678',
          fee: null,
          feeAsset: null,
          type: 'transfer' as const,
          counterparty: null,
          verified: null,
        },
      ],
      info: { notes: ['x'] },
      fetchedAt: '2026-10-08T10:00:00.000Z',
    };
    await wallets.saveData(data);
    await wallets.saveData({
      ...data,
      status: 'error',
      errorCode: 'rateLimited',
    });
    const [stored] = await wallets.listData([wallet.id]);
    expect(stored).toMatchObject({ status: 'error', errorCode: 'rateLimited' });
    expect(stored?.movements[0]?.quantity).toBe('0.123456789012345678');

    await wallets.setOverride(wallet.id, 'ethereum', '0xabc', true);
    await wallets.setOverride(wallet.id, 'ethereum', '0xabc', true);
    expect(await wallets.listOverrides(wallet.id)).toEqual([
      { network: 'ethereum', tokenKey: '0xabc' },
    ]);
    await wallets.setOverride(wallet.id, 'ethereum', '0xabc', false);
    expect(await wallets.listOverrides(wallet.id)).toEqual([]);

    const balance = await wallets.addBalance({
      projectId: project.id,
      walletId: wallet.id,
      network: 'ethereum',
      asset: 'ETH',
      quantity: '1.5',
      asOf: '2025-12-31',
      evidenceFileId: null,
      note: '',
    });
    expect(await wallets.findBalance(balance.id)).toMatchObject({
      quantity: '1.5',
    });
    await wallets.removeFromProject(project.id, wallet.id);
    expect(await wallets.listBalances(project.id)).toEqual([]);
    expect(await wallets.listWalletIds(project.id)).toEqual([]);

    expect(await wallets.delete(wallet.id)).toBe(true);
    expect(await wallets.listData([wallet.id])).toEqual([]);
    await prisma.user.delete({ where: { id: bob.id } });
    expect(await prisma.wallet.count({ where: { ownerId: bob.id } })).toBe(0);
  });

  it('keeps the CHECKs: address kind, networks JSON, data status, balance quantity/date', async () => {
    const owner = await newUser('w-check');
    const project = await newProject(owner.id);
    const now = toSqliteTimestamp(new Date());
    const wallet = (columns: Record<string, unknown>) =>
      insert('wallet', {
        id: randomUUID(),
        owner_id: owner.id,
        label: 'x',
        address: EVM,
        address_kind: 'evm',
        networks: '[]',
        updated_at: now,
        ...columns,
      });
    for (const bad of [
      { address_kind: 'ripple' },
      { networks: '{"a":1}' },
      { label: ' ' },
      { network_check: 'nope' },
    ]) {
      await expect(wallet(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
    const id = randomUUID();
    await expect(wallet({ id })).resolves.toBe(1);
    for (const bad of [
      { network: 'ripple' },
      { status: 'maybe' },
      { status: 'error' },
      { movements: 'nope' },
    ]) {
      await expect(
        insert('wallet_network_data', {
          wallet_id: id,
          network: 'ethereum',
          status: 'ok',
          fetched_at: now,
          ...bad,
        }),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
    for (const bad of [
      { quantity: '-1' },
      { quantity: '1e5' },
      { as_of: '31.12.2025' },
      { asset: ' ' },
    ]) {
      await expect(
        insert('wallet_manual_balance', {
          id: randomUUID(),
          project_id: project.id,
          wallet_id: id,
          network: 'cardano',
          asset: 'ADA',
          quantity: '1',
          as_of: '2025-12-31',
          ...bad,
        }),
      ).rejects.toThrow(/CHECK constraint failed/);
    }
  });
});

describe('chain_settings', () => {
  it('upserts one row per user with sealed keys only', async () => {
    const user = await newUser('w-settings');
    expect(await chainSettings.find(user.id)).toBeUndefined();
    await chainSettings.save(user.id, {
      sealedHeliusKey: 'enc:v1:a:b:c',
      esploraUrl: 'https://esplora.example/api',
    });
    const saved = await chainSettings.save(user.id, {
      koiosUrl: 'https://k.example',
    });
    expect(saved).toMatchObject({
      sealedHeliusKey: 'enc:v1:a:b:c',
      esploraUrl: 'https://esplora.example/api',
      koiosUrl: 'https://k.example',
      sealedSubscanKey: null,
    });
    await expect(
      insert('chain_settings', {
        user_id: (await newUser('w-plain')).id,
        helius_key: 'plain-text-key',
        updated_at: toSqliteTimestamp(new Date()),
      }),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});

describe('project_file after the wallets migration', () => {
  it('accepts wallet origins and keeps every older CHECK', async () => {
    const owner = await newUser('w-file');
    const project = await newProject(owner.id);
    const csv = new TextEncoder().encode('Zeitpunkt,Plattform\n');
    const added = await files.add({
      ownerId: owner.id,
      projectId: project.id,
      stored: {
        create: {
          sha256: createHash('sha256').update(csv).digest('hex'),
          bytes: csv,
          mediaType: 'text/csv',
          kind: 'csv',
          originalName: 'Ledger.wallet-buchungen.csv',
        },
      },
      displayName: 'Ledger.wallet-buchungen.csv',
      origin: `wallet:${randomUUID()}`,
      analysis: NOT_ANALYSED,
    });
    if (!('created' in added)) throw new Error('expected a new entry');
    expect(added.created.origin).toMatch(/^wallet:/);

    const entry = (columns: Record<string, unknown>) =>
      insert('project_file', {
        id: randomUUID(),
        project_id: project.id,
        file_id: added.created.fileId,
        display_name: 'x.csv',
        status: 'standard',
        coverage: '[]',
        origin: 'uploaded',
        added_at: toSqliteTimestamp(new Date()),
        ...columns,
      });
    for (const bad of [
      { origin: 'wallet:' },
      { origin: 'derived_from:' },
      { status: 'mapped' },
      { booking_count: -1 },
      { coverage: 'nope' },
      { display_name: ' ' },
    ]) {
      await expect(entry(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
    await expect(entry({})).rejects.toThrow(/UNIQUE constraint failed/);
  });
});
