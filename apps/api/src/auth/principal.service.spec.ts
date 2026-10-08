import type {
  PrincipalRecord,
  User,
  VerifiedIdentity,
} from '../users/domain/user';
import type { UserRepositoryPort } from '../users/ports/user.repository.port';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { PrincipalService } from './principal.service';

const identity: VerifiedIdentity = {
  uid: 'uid-1',
  email: 'anna@lazykoins.dev',
  emailVerified: true,
  name: null,
  signInProvider: 'dev',
};

function setup(
  record: PrincipalRecord | undefined,
  env: Partial<Record<'AUTH_MODE' | 'PLATFORM_ADMIN_EMAILS', string>> = {},
) {
  const upsertFromIdentity = vi.fn(
    async (_identity: VerifiedIdentity, displayName: string) =>
      ({ id: 'new', displayName }) as unknown as User,
  );
  const grantPlatformAdmin = vi.fn(async () => undefined);
  const touchLastSeen = vi.fn(async () => undefined);
  const users = {
    findPrincipalByIdentityUid: async () => record,
    upsertFromIdentity,
    grantPlatformAdmin,
    touchLastSeen,
  } as unknown as UserRepositoryPort;
  const config = {
    get: (key: string) =>
      ({ AUTH_MODE: 'dev', PLATFORM_ADMIN_EMAILS: '', ...env })[key],
  } as unknown as ConfigService<Env, true>;
  return {
    service: new PrincipalService(users, config),
    upsertFromIdentity,
    grantPlatformAdmin,
    touchLastSeen,
  };
}

describe('PrincipalService', () => {
  it('resolves a known user without writing', async () => {
    const { service, upsertFromIdentity } = setup({ id: 'u1' });
    await expect(service.resolve(identity)).resolves.toEqual({
      userId: 'u1',
      email: 'anna@lazykoins.dev',
    });
    expect(upsertFromIdentity).not.toHaveBeenCalled();
  });

  it('creates the account on first sight, named after the e-mail when there is no name', async () => {
    const { service, upsertFromIdentity } = setup(undefined);
    await expect(service.resolve(identity)).resolves.toMatchObject({
      userId: 'new',
    });
    expect(upsertFromIdentity).toHaveBeenCalledWith(identity, 'anna');
  });

  it('refuses a blocked account with 403 accountBlocked', async () => {
    const { service } = setup({
      id: 'u1',
      blockedAt: '2026-10-01T00:00:00.000Z',
    });
    await expect(service.resolve(identity)).rejects.toMatchObject({
      response: { code: 'accountBlocked' },
    });
  });

  it('makes a bootstrap address admin only with a verified e-mail', async () => {
    const env = { PLATFORM_ADMIN_EMAILS: ' Anna@LazyKoins.dev , other@x.ch' };
    const verified = setup({ id: 'u1' }, env);
    await expect(verified.service.resolve(identity)).resolves.toMatchObject({
      isPlatformAdmin: true,
    });
    expect(verified.grantPlatformAdmin).toHaveBeenCalledWith('u1');

    const unverified = setup({ id: 'u1' }, env);
    const result = await unverified.service.resolve({
      ...identity,
      emailVerified: false,
    });
    expect(result.isPlatformAdmin).toBeUndefined();
    expect(unverified.grantPlatformAdmin).not.toHaveBeenCalled();

    const desktop = setup({ id: 'u1' }, { ...env, AUTH_MODE: 'local' });
    await desktop.service.resolve(identity);
    expect(desktop.grantPlatformAdmin).not.toHaveBeenCalled();
  });

  it('writes the last request at most every 15 minutes', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const fresh = setup({ id: 'u1', lastSeenAt: recent });
    await fresh.service.resolve(identity);
    expect(fresh.touchLastSeen).not.toHaveBeenCalled();
    const old = setup({ id: 'u1', lastSeenAt: '2026-01-01T00:00:00.000Z' });
    await old.service.resolve(identity);
    expect(old.touchLastSeen).toHaveBeenCalledWith('u1', expect.any(String));
  });
});
