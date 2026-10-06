import { Injectable } from '@nestjs/common';
import { displayNameFor, type VerifiedIdentity } from '../users/domain/user';
import { UserRepositoryPort } from '../users/ports/user.repository.port';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * Turns a verified identity into the request principal, creating the account on first sight.
 *
 * Called on every authenticated request, so it calls the port directly rather than through the
 * query bus (same exception surf-lend and etx make for their principal lookup). The common case
 * is one indexed lookup by identity uid; the upsert only runs for a uid never seen before — the
 * first request after sign-up.
 */
@Injectable()
export class PrincipalService {
  constructor(private readonly users: UserRepositoryPort) {}

  async resolve(identity: VerifiedIdentity): Promise<AuthenticatedUser> {
    const known = await this.users.findPrincipalByIdentityUid(identity.uid);
    const id =
      known?.id ??
      (await this.users.upsertFromIdentity(identity, displayNameFor(identity)))
        .id;
    return { userId: id, email: identity.email ?? '' };
  }
}
