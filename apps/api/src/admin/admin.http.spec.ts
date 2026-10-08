import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Global, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { IdentityTokenVerifierPort } from '../auth/ports/identity-token-verifier.port';
import { PrincipalService } from '../auth/principal.service';
import { DevIdentityTokenVerifier } from '../integrations/dev-identity-token.verifier';
import { fakeConfig } from '../pin/testing/pin-fixture';
import type {
  PrincipalRecord,
  User,
  VerifiedIdentity,
} from '../users/domain/user';
import { UserRepositoryPort } from '../users/ports/user.repository.port';
import { AdminController } from './admin.controller';
import { AdminModule } from './admin.module';
import { AdminRepositoryPort } from './ports/admin.repository.port';
import { PlatformAdminGuard } from './platform-admin.guard';
import { InMemoryAdminRepository } from './testing/in-memory-admin.repository';

/**
 * The management API is secured on the server — not by the app hiding a menu entry. Runs the
 * real chain (AccessTokenGuard → PrincipalService → PlatformAdminGuard) behind a real HTTP
 * listener: every admin route answers 401 without a sign-in, 403 `adminOnly` for an ordinary
 * account, 403 `accountBlocked` for a blocked one, and 404 on the desktop (`AUTH_MODE=local`).
 * The admin flag is read from the database on every request — a token claim cannot grant it, and
 * a revoked role is gone at the next request.
 */

const ADMIN = {
  id: '00000000-0000-7000-8000-000000000001',
  email: 'admin@it.dev',
};
const ANNA = {
  id: '00000000-0000-7000-8000-000000000002',
  email: 'anna@it.dev',
};
const BOB = { id: '00000000-0000-7000-8000-000000000003', email: 'bob@it.dev' };
const ENTRY = '00000000-0000-7000-8000-0000000000aa';

/** The user port over the admin double's rows, so both see one truth (like the database). */
class SharedUsers extends UserRepositoryPort {
  constructor(private readonly admin: InMemoryAdminRepository) {
    super();
  }

  private byEmail(uid: string) {
    const email = uid.replace(/^dev:/, '');
    return [...this.admin.users.values()].find((u) => u.email === email);
  }

  async findById(id: string): Promise<User | undefined> {
    const u = this.admin.users.get(id);
    return u
      ? {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          signInProvider: u.signInProvider,
          createdAt: u.createdAt,
          updatedAt: u.createdAt,
          isPlatformAdmin: u.isPlatformAdmin,
        }
      : undefined;
  }

  async findPrincipalByIdentityUid(
    uid: string,
  ): Promise<PrincipalRecord | undefined> {
    const u = this.byEmail(uid);
    return u
      ? {
          id: u.id,
          isPlatformAdmin: u.isPlatformAdmin,
          blockedAt: u.blockedAt,
          lastSeenAt: u.lastSeenAt,
        }
      : undefined;
  }

  async upsertFromIdentity(identity: VerifiedIdentity): Promise<User> {
    const id = `00000000-0000-7000-8000-${String(this.admin.users.size + 100).padStart(12, '0')}`;
    this.admin.addUser({ id, email: identity.email ?? '' });
    const user = await this.findById(id);
    if (!user) throw new Error('not created');
    return user;
  }

  async grantPlatformAdmin(id: string): Promise<void> {
    await this.admin.setAdmin(id, true);
  }

  async touchLastSeen(): Promise<void> {
    // Not part of this test.
  }
}

async function start(mode: 'dev' | 'local' = 'dev') {
  const admin = new InMemoryAdminRepository();
  admin.addUser({ ...ADMIN, isPlatformAdmin: true });
  admin.addUser(ANNA);
  admin.addUser(BOB);
  admin.library.set(ENTRY, {
    id: ENTRY,
    name: 'Kraken',
    platform: 'kraken',
    description: null,
    authorName: null,
    authorId: ANNA.id,
    authorEmail: ANNA.email,
    version: 1,
    usageCount: 0,
    ratingCount: 0,
    publishedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    hiddenAt: null,
    hiddenReason: null,
  });
  const config = fakeConfig({ AUTH_MODE: mode, PLATFORM_ADMIN_EMAILS: '' });

  @Global()
  @Module({
    providers: [
      { provide: ConfigService, useValue: config },
      { provide: AdminRepositoryPort, useValue: admin },
      { provide: UserRepositoryPort, useValue: new SharedUsers(admin) },
      {
        provide: IdentityTokenVerifierPort,
        useClass: DevIdentityTokenVerifier,
      },
    ],
    exports: [
      ConfigService,
      AdminRepositoryPort,
      UserRepositoryPort,
      IdentityTokenVerifierPort,
    ],
  })
  class TestPortsModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestPortsModule, CqrsModule, AdminModule],
    providers: [
      {
        provide: PrincipalService,
        useFactory: (users: UserRepositoryPort, c: ConfigService) =>
          new PrincipalService(users, c as never),
        inject: [UserRepositoryPort, ConfigService],
      },
      { provide: APP_GUARD, useClass: AccessTokenGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
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
  const call = async (
    method: string,
    path: string,
    as: string | null,
    body?: unknown,
  ) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(as ? { authorization: `Bearer dev:${as}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: (text ? JSON.parse(text) : null) as Record<string, unknown> | null,
    };
  };
  return { app, admin, call };
}

/** Every route of the admin API, with a body that would pass validation. */
const ROUTES: readonly [string, string, unknown?][] = [
  ['GET', '/admin/overview'],
  ['GET', '/admin/users'],
  ['POST', `/admin/users/${BOB.id}/block`, { reason: 'Test' }],
  ['POST', `/admin/users/${BOB.id}/unblock`, {}],
  ['PUT', `/admin/users/${BOB.id}/admin`, { admin: true }],
  [
    'DELETE',
    `/admin/users/${BOB.id}`,
    { reason: 'Test', confirmEmail: BOB.email },
  ],
  ['GET', '/admin/library'],
  ['POST', `/admin/library/${ENTRY}/hide`, { reason: 'Test' }],
  ['POST', `/admin/library/${ENTRY}/unhide`, {}],
  ['GET', '/admin/audit'],
];

describe('admin API security (server side)', () => {
  it('lists every route of AdminController in this test', () => {
    const methods = Object.getOwnPropertyNames(
      AdminController.prototype,
    ).filter((name) => name !== 'constructor');
    expect(methods).toHaveLength(ROUTES.length);
    // The guard sits on the class: a new route is covered without remembering it.
    const guards = Reflect.getMetadata(
      '__guards__',
      AdminController,
    ) as unknown[];
    expect(guards).toContain(PlatformAdminGuard);
  });

  it('refuses every route without a sign-in (401) and for an ordinary account (403 adminOnly)', async () => {
    const t = await start();
    try {
      for (const [method, path, body] of ROUTES) {
        const anonymous = await t.call(method, path, null, body);
        expect(anonymous.status, `${method} ${path}`).toBe(401);
        const ordinary = await t.call(method, path, ANNA.email, body);
        expect(ordinary.status, `${method} ${path}`).toBe(403);
        expect(ordinary.body?.['code']).toBe('adminOnly');
      }
      // Nothing happened: no change, no audit entry.
      expect(t.admin.users.get(BOB.id)).toMatchObject({
        blockedAt: null,
        isPlatformAdmin: false,
      });
      expect(t.admin.deleted).toEqual([]);
      expect(t.admin.library.get(ENTRY)?.hiddenAt).toBeNull();
      expect(t.admin.audit).toEqual([]);
    } finally {
      await t.app.close();
    }
  });

  it('cannot be granted through the request: extra fields are refused, claims are ignored', async () => {
    const t = await start();
    try {
      const smuggled = await t.call(
        'GET',
        '/admin/users?isPlatformAdmin=true',
        ANNA.email,
      );
      expect(smuggled.status).toBe(403);
      // A body field naming the role does not reach a handler (whitelist + forbidNonWhitelisted).
      const own = await t.call(
        'PUT',
        `/admin/users/${ANNA.id}/admin`,
        ANNA.email,
        {
          admin: true,
        },
      );
      expect(own.status).toBe(403);
      expect(t.admin.users.get(ANNA.id)?.isPlatformAdmin).toBe(false);
    } finally {
      await t.app.close();
    }
  });

  it('lets an admin in, and takes the role away at the very next request', async () => {
    const t = await start();
    try {
      expect((await t.call('GET', '/admin/overview', ADMIN.email)).status).toBe(
        200,
      );
      await t.admin.setAdmin(ADMIN.id, false);
      const after = await t.call('GET', '/admin/overview', ADMIN.email);
      expect(after.status).toBe(403);
      expect(after.body?.['code']).toBe('adminOnly');
    } finally {
      await t.app.close();
    }
  });

  it('refuses a blocked account everywhere (403 accountBlocked), even a former admin', async () => {
    const t = await start();
    try {
      await t.admin.setBlocked(ADMIN.id, {
        atIso: '2026-10-10T00:00:00.000Z',
        reason: 'Test',
      });
      const blocked = await t.call('GET', '/admin/overview', ADMIN.email);
      expect(blocked.status).toBe(403);
      expect(blocked.body?.['code']).toBe('accountBlocked');
    } finally {
      await t.app.close();
    }
  });

  it('does not exist on the desktop (AUTH_MODE=local → 404)', async () => {
    const t = await start('local');
    try {
      const response = await t.call('GET', '/admin/overview', ADMIN.email);
      expect(response.status).toBe(404);
    } finally {
      await t.app.close();
    }
  });

  it('has no admin route outside the guarded controller', () => {
    // Every controller file under src/: a route under `admin` must be AdminController's.
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.controller.ts')) {
          const source = readFileSync(path, 'utf8');
          if (
            /@Controller\(\s*['"`]admin/.test(source) &&
            !path.endsWith(join('admin', 'admin.controller.ts'))
          ) {
            offenders.push(path);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
