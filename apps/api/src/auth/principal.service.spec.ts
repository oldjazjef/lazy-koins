import type {
  PrincipalRecord,
  User,
  VerifiedIdentity,
} from '../users/domain/user';
import type { UserRepositoryPort } from '../users/ports/user.repository.port';
import { PrincipalService } from './principal.service';

const identity: VerifiedIdentity = {
  uid: 'uid-1',
  email: 'anna@lazykoins.dev',
  emailVerified: true,
  name: null,
  signInProvider: 'dev',
};

function setup(record: PrincipalRecord | undefined) {
  const upsertFromIdentity = vi.fn(
    async (_identity: VerifiedIdentity, displayName: string) =>
      ({ id: 'new', displayName }) as unknown as User,
  );
  const users = {
    findPrincipalByIdentityUid: async () => record,
    upsertFromIdentity,
  } as unknown as UserRepositoryPort;
  return { service: new PrincipalService(users), upsertFromIdentity };
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
});
