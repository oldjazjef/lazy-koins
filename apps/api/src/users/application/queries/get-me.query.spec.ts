import { NotFoundException } from '@nestjs/common';
import type { User } from '../../domain/user';
import { UserRepositoryPort } from '../../ports/user.repository.port';
import { GetMeHandler, GetMeQuery } from './get-me.query';

const ANNA: User = {
  id: 'u1',
  email: 'anna@lazykoins.dev',
  displayName: 'Anna',
  signInProvider: 'dev',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

class InMemoryUsers extends UserRepositoryPort {
  async findById(id: string) {
    return id === ANNA.id ? ANNA : undefined;
  }
  async findPrincipalByIdentityUid() {
    return undefined;
  }
  async upsertFromIdentity(): Promise<User> {
    throw new Error('not used');
  }
}

describe('GetMeHandler', () => {
  const handler = new GetMeHandler(new InMemoryUsers());

  it('returns the signed-in user', async () => {
    await expect(handler.execute(new GetMeQuery('u1'))).resolves.toBe(ANNA);
  });

  it('answers 404 for an unknown id', async () => {
    await expect(
      handler.execute(new GetMeQuery('nope')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
