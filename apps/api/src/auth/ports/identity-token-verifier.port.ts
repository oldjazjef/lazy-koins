import type { VerifiedIdentity } from '../../users/domain/user';

/**
 * Turns a bearer token into a verified identity, or `undefined` if the token is invalid, expired
 * or revoked. Firebase in production (`integrations/firebase`), `dev:<email>` tokens locally,
 * one fixed user in the desktop app — chosen by `AUTH_MODE` in `IntegrationsModule`.
 */
export abstract class IdentityTokenVerifierPort {
  abstract verify(token: string): Promise<VerifiedIdentity | undefined>;

  /**
   * The identity of a request that carries no token at all. `undefined` — anonymous — for every
   * mode but `local`, where the desktop app's single user is implied by being on the machine.
   */
  ambient(): VerifiedIdentity | undefined {
    return undefined;
  }
}
