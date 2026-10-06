import type { PrincipalRecord, User, VerifiedIdentity } from '../domain/user';

/**
 * Persistence contract for users. An abstract class so it is both the contract and the Nest DI
 * token; the Prisma binding lives in `PersistenceModule`.
 */
export abstract class UserRepositoryPort {
  abstract findById(id: string): Promise<User | undefined>;

  abstract findPrincipalByIdentityUid(
    uid: string,
  ): Promise<PrincipalRecord | undefined>;

  /**
   * Creates the user on first sight of an identity uid, or refreshes the provider-owned fields
   * (e-mail, provider) on later ones. The display name is only set on creation.
   */
  abstract upsertFromIdentity(
    identity: VerifiedIdentity,
    displayName: string,
  ): Promise<User>;
}
