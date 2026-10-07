import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateMappingSpec } from '@lazykoins/engine';
import {
  IpThrottlerGuard,
  throttlerOptions,
} from '../common/throttling/throttling';
import { LibraryRuntime } from './application/library-runtime';
import {
  PublicLibraryEntryHandler,
  PublicLibraryMatchHandler,
  PublicLibraryPageHandler,
} from './application/public-library.handlers';
import { PUBLIC_ENTRY_KEYS } from './domain/public-library';
import { LibraryRepositoryPort } from './ports/library.repository.port';
import {
  PublicLibraryController,
  PublicLibraryEnabledGuard,
  PublicLibraryService,
} from './public-library.controller';
import { InMemoryLibraryRepository } from './testing/in-memory-library.repository';

/**
 * F5.18: the public endpoint over real HTTP — the controller with its guards, the real per-IP
 * throttler and the validation pipe of `bootstrap.ts`. (Without a sign-in end to end, with the
 * whole AppModule: `tools.isolation.integration.spec.ts`.)
 */
const SPEC = (() => {
  const result = validateMappingSpec(
    JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../libs/engine/src/mapping/fixtures/kraken-ledger.mapping.json',
        ),
        'utf8',
      ),
    ),
  );
  if (!result.ok) throw new Error('fixture');
  return result.spec;
})();

const UUID = '01890a5d-ac96-774b-bcce-b302099a8057';

async function start(runtime: LibraryRuntime) {
  const repo = new InMemoryLibraryRepository();
  const kept = await repo.create('author-secret-id', {
    authorName: 'Krakenfan',
    sourceMappingId: 'source-mapping-secret',
    description: 'Synthetic Kraken ledger',
    spec: SPEC,
  });
  const gone = await repo.create('author-secret-id', {
    authorName: null,
    sourceMappingId: null,
    description: 'Deleted one',
    spec: { ...SPEC, name: 'Old Kraken' },
  });
  await repo.softDelete(gone.id, '2026-10-09T00:00:00.000Z');
  // The public routes take UUIDs (the in-memory double numbers its ids).
  for (const [index, entry] of [kept, gone].entries()) {
    const id = `01890a5d-ac96-774b-bcce-00000000000${index}`;
    const row = repo.rows.get(entry.id);
    if (!row) throw new Error('row missing');
    repo.rows.set(id, { ...row, id });
    repo.rows.delete(entry.id);
  }
  const ids = {
    kept: { id: '01890a5d-ac96-774b-bcce-000000000000' },
    gone: { id: '01890a5d-ac96-774b-bcce-000000000001' },
  };
  const moduleRef = await Test.createTestingModule({
    imports: [
      CqrsModule.forRoot(),
      ThrottlerModule.forRootAsync({ useFactory: throttlerOptions }),
    ],
    controllers: [PublicLibraryController],
    providers: [
      { provide: LibraryRuntime, useValue: runtime },
      { provide: LibraryRepositoryPort, useValue: repo },
      { provide: APP_GUARD, useClass: IpThrottlerGuard },
      PublicLibraryEnabledGuard,
      PublicLibraryService,
      PublicLibraryPageHandler,
      PublicLibraryEntryHandler,
      PublicLibraryMatchHandler,
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({
    logger: false,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, api: `http://127.0.0.1:${port}/api`, ...ids };
}

const matchBody = (headers: readonly string[] = SPEC.match.headers) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fileName: 'ledgers.csv', headers }),
});

describe('public library endpoint (F5.18)', () => {
  let web: Awaited<ReturnType<typeof start>>;

  beforeAll(async () => {
    web = await start(new LibraryRuntime(true));
  });
  afterAll(async () => {
    await web.app.close();
  });

  it('lists active entries with exactly the allow-listed keys, cacheable', async () => {
    const response = await fetch(`${web.api}/public/library`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    const body = (await response.json()) as {
      items: Record<string, unknown>[];
      total: number;
      limit: number;
    };
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.items.map((item) => item['id'])).toEqual([web.kept.id]);
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(
      [...PUBLIC_ENTRY_KEYS].sort(),
    );
    const text = JSON.stringify(body);
    expect(text).not.toContain('author-secret-id');
    expect(text).not.toContain('source-mapping-secret');
    expect(text).not.toContain('Old Kraken');
  });

  it('shows one entry with its spec; a deleted one is a 404', async () => {
    const one = await fetch(`${web.api}/public/library/${web.kept.id}`);
    expect(one.status).toBe(200);
    const body = (await one.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [...PUBLIC_ENTRY_KEYS, 'spec'].sort(),
    );
    expect(
      (await fetch(`${web.api}/public/library/${web.gone.id}`)).status,
    ).toBe(404);
  });

  it('validates the paging and the match body (only fileName + headers)', async () => {
    expect((await fetch(`${web.api}/public/library?limit=51`)).status).toBe(
      400,
    );
    expect((await fetch(`${web.api}/public/library?sort=evil`)).status).toBe(
      400,
    );
    const extra = await fetch(`${web.api}/public/library/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'x.csv', headers: ['a'], rows: [] }),
    });
    expect(extra.status).toBe(400);
  });

  it('matches by header row + file name, not cacheable', async () => {
    const response = await fetch(
      `${web.api}/public/library/match`,
      matchBody(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toEqual([web.kept.id]);
  });

  it('throttles match requests per IP (30 per minute)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      statuses.push(
        (await fetch(`${web.api}/public/library/match`, matchBody(['x', 'y'])))
          .status,
      );
    }
    // Earlier tests used a few requests of this budget already.
    expect(statuses[0]).toBe(200);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(30);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('public library endpoint switched off (F5.18)', () => {
  it.each([
    [
      'LIBRARY_PUBLIC=false',
      new LibraryRuntime(true, undefined, { publicEndpoint: false }),
    ],
    ['the desktop (AUTH_MODE=local)', new LibraryRuntime(false)],
  ])('answers 404 everywhere with %s', async (_label, runtime) => {
    const off = await start(runtime);
    try {
      expect((await fetch(`${off.api}/public/library`)).status).toBe(404);
      expect(
        (await fetch(`${off.api}/public/library/${off.kept.id}`)).status,
      ).toBe(404);
      // The guard answers before the id is even parsed.
      expect((await fetch(`${off.api}/public/library/not-a-uuid`)).status).toBe(
        404,
      );
      expect(
        (await fetch(`${off.api}/public/library/match`, matchBody())).status,
      ).toBe(404);
      expect((await fetch(`${off.api}/public/library/${UUID}`)).status).toBe(
        404,
      );
    } finally {
      await off.app.close();
    }
  });
});
